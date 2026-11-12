import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { LoginRateLimiter } from './login-rate-limit.js'
import { PEER_ADDR_HEADER, getClientKeys, getTrustedProxyHops, type ClientKeys } from './client-ip.js'

/**
 * Limits on the agent WebSocket (/api/agents/ws) that hold before a socket has
 * authenticated: anyone can open the path, so what an unauthenticated socket
 * may cost the process (memory, bcrypt time, open sockets) is bounded here.
 */

/**
 * Largest message the server accepts at all (ws `maxPayload`, one value per
 * server). ws buffers a whole message before any handler runs, so this is the
 * memory one socket can make the server hold. The largest snapshot the
 * reference agent builds is about 360 KiB in the worst case (four memory files
 * of 10,240 characters, each JSON-escaped to at most 6 bytes per character,
 * plus 20 sessions of 5 messages of 200 characters, same escaping), typically
 * a tenth of that; 1 MiB leaves room for many containers and cron jobs. A
 * larger message closes the socket with 1009.
 */
export const AGENT_WS_MAX_PAYLOAD_BYTES = 1024 * 1024

/**
 * Largest message accepted before authentication. The auth message is a token
 * and a few short strings; 8 KiB is far above that. Checked on the raw bytes,
 * before JSON.parse.
 */
export const AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES = 8 * 1024

/** A socket that has not authenticated this long after connecting is closed. */
export const AGENT_WS_AUTH_TIMEOUT_MS = 10_000

/** Sockets that may be connected and not yet authenticated, all clients together. */
export const AGENT_WS_MAX_UNAUTHENTICATED = 32

/** After the server asks an unauthenticated socket to close, it is destroyed if it has not closed by then. */
export const AGENT_WS_CLOSE_GRACE_MS = 2000

/**
 * Handshakes per client that may reach the token store and bcrypt in one
 * window (see LOGIN_WINDOW_MS). A handshake is counted when it is admitted,
 * and a successful one removes the count, so this is a budget of failures. It
 * is larger than the login budget because several agents can share one address
 * (a NAT, one host).
 */
export const AGENT_WS_HANDSHAKE_MAX_ATTEMPTS = 10

/** Close codes (RFC 6455 / IANA) the server uses before authentication. */
export const WS_CLOSE_POLICY = 1008
export const WS_CLOSE_TOO_BIG = 1009
export const WS_CLOSE_TRY_AGAIN_LATER = 1013

/** Failed (or in-flight) persisted-token handshakes per client IP. Static tokens are not counted. */
export const agentHandshakeLimiter = new LoginRateLimiter(AGENT_WS_HANDSHAKE_MAX_ATTEMPTS)

/**
 * The WebSocket server for /api/agents/ws. ws buffers a whole message before
 * any handler sees it and the path is open to anyone, so the size cap is set
 * on the server itself.
 */
export function createAgentWebSocketServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true, maxPayload: AGENT_WS_MAX_PAYLOAD_BYTES })
}

let unauthenticated = 0

/** Sockets currently counted against AGENT_WS_MAX_UNAUTHENTICATED. */
export function unauthenticatedSocketCount(): number {
  return unauthenticated
}

/**
 * Rate-limit keys of the client behind an upgrade request, derived like the
 * routes derive them (peer address, or the N-th X-Forwarded-For address from
 * the right with TRUSTED_PROXY_HOPS = N; see getClientKeys). The upgrade does
 * not pass through the request listener that stamps the peer header, so the
 * socket address is read here directly.
 */
export function upgradeClientKeys(req: IncomingMessage, hops: number = getTrustedProxyHops()): ClientKeys {
  const headers = new Headers()
  const peer = req.socket?.remoteAddress
  if (peer) headers.set(PEER_ADDR_HEADER, peer)
  const forwarded = req.headers?.['x-forwarded-for']
  if (forwarded !== undefined) headers.set('x-forwarded-for', Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
  return getClientKeys(headers, hops)
}

function byteLength(raw: Buffer | string): number {
  return typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length
}

// Ask the socket to close, and destroy it if the peer does not answer the close
// handshake (ws alone waits 30 s). Returns the cancel function for the destroy timer.
function closeAndReap(ws: WebSocket, code: number, reason: string): () => void {
  try {
    ws.close(code, reason)
  } catch {
    // already closing
  }
  const reap = setTimeout(() => {
    try {
      ws.terminate()
    } catch {
      // already gone
    }
  }, AGENT_WS_CLOSE_GRACE_MS)
  return () => clearTimeout(reap)
}

/** What the handler asks of the pre-authentication limits of one socket. */
export interface PreAuthGuard {
  /** True once the socket closed, errored or was rejected here; its handler must not register an agent. */
  readonly gone: boolean
  /** True (and the socket is closed with 1009) when a pre-auth message is over the limit. Check before JSON.parse. */
  tooLarge(raw: Buffer | string): boolean
  /**
   * Charge one persisted-token handshake to the client IP. False (and the
   * socket is closed with 1008) when the IP's budget is used up; call it
   * before the token store is read.
   */
  admitHandshake(): boolean
  /** The socket authenticated: stop the deadline, free the slot, clear the IP's failures if it was charged. */
  authenticated(): void
}

/**
 * Count a new socket as unauthenticated. Returns null, after closing the
 * socket with 1013, when AGENT_WS_MAX_UNAUTHENTICATED sockets are already
 * waiting. Otherwise starts the authentication deadline; the slot is given
 * back exactly once, by whichever of authentication, close, error or the
 * deadline comes first.
 */
export function admitUnauthenticated(ws: WebSocket, req: IncomingMessage): PreAuthGuard | null {
  if (unauthenticated >= AGENT_WS_MAX_UNAUTHENTICATED) {
    // A socket without an error listener would crash the process on an error event.
    ws.on('error', () => {})
    const cancelReap = closeAndReap(ws, WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
    ws.on('close', cancelReap)
    return null
  }

  unauthenticated += 1
  let held = true
  let gone = false
  let client: ClientKeys | null = null
  let charged = false
  let cancelReap: (() => void) | null = null

  const release = () => {
    if (!held) return
    held = false
    unauthenticated -= 1
  }
  const finish = () => {
    gone = true
    clearTimeout(deadline)
    cancelReap?.()
    release()
  }
  const reject = (code: number, reason: string) => {
    if (gone) return
    gone = true
    clearTimeout(deadline)
    release()
    cancelReap = closeAndReap(ws, code, reason)
  }
  // finish() and reject() read `deadline`; neither runs before this line.
  const deadline = setTimeout(() => reject(WS_CLOSE_POLICY, 'Authentication timeout'), AGENT_WS_AUTH_TIMEOUT_MS)
  ws.on('close', finish)
  ws.on('error', finish)

  return {
    get gone() {
      return gone
    },
    tooLarge(raw) {
      if (byteLength(raw) <= AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES) return false
      reject(WS_CLOSE_TOO_BIG, 'Message too big')
      return true
    },
    admitHandshake() {
      client ??= upgradeClientKeys(req)
      const gate = agentHandshakeLimiter.acquire(client.key, client.parent)
      if (!gate.allowed) {
        reject(WS_CLOSE_POLICY, 'Too many attempts')
        return false
      }
      charged = true
      return true
    },
    authenticated() {
      clearTimeout(deadline)
      release()
      if (charged && client) {
        agentHandshakeLimiter.reset(client.key, client.parent)
        agentHandshakeLimiter.recordSuccess(client.key, client.parent)
      }
    },
  }
}
