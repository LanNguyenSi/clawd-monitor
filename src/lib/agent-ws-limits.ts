import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { LoginRateLimiter } from './login-rate-limit.js'
import { PEER_ADDR_HEADER, getClientKeys, getTrustedProxyHops, type ClientKeys } from './client-ip.js'

/**
 * Limits on the agent WebSocket (/api/agents/ws). Before a socket has
 * authenticated, anyone can open the path, so what an unauthenticated socket
 * may cost the process (memory, bcrypt time, open sockets) is bounded here.
 * After authentication the number of open sockets is bounded too (in total and
 * per client key), and a heartbeat closes a socket whose peer stopped
 * answering, so a half-open connection cannot keep an agent online for ever.
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

/**
 * Of those, the most one client key may hold (the peer address, or the one the
 * trusted proxy saw; an IPv6 client is keyed by its /64). Without it a single
 * address could fill every slot and keep legitimate agents out.
 */
export const AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY = 4

/** Same for the /48 around an IPv6 client, which holds many /64 keys. */
export const AGENT_WS_MAX_UNAUTHENTICATED_PER_PARENT = 16

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

/**
 * The server pings every authenticated socket this often; a socket that did
 * not answer the previous ping by the next tick is terminated. A dead peer is
 * therefore noticed after one to two intervals. Not configurable.
 */
export const AGENT_WS_PING_INTERVAL_MS = 30_000

/** Authenticated sockets that may be open at once, all clients together. */
export const AGENT_WS_MAX_AUTHENTICATED = 128

/**
 * Of those, the most one client key may hold (the peer address, or the one the
 * trusted proxy saw; an IPv6 client is keyed by its /64). Behind a reverse
 * proxy without TRUSTED_PROXY_HOPS every agent has the proxy's address as its
 * key, so there they share this budget.
 */
export const AGENT_WS_MAX_AUTHENTICATED_PER_KEY = 16

/** Close codes (RFC 6455 / IANA) the server uses before authentication. */
export const WS_CLOSE_POLICY = 1008
export const WS_CLOSE_TOO_BIG = 1009
export const WS_CLOSE_TRY_AGAIN_LATER = 1013

/**
 * Application close code (4000-4999 is free for applications) for a socket
 * that a newer connection of the same agentId replaced.
 */
export const AGENT_WS_REPLACED_CLOSE_CODE = 4000

/** Failed (or in-flight) persisted-token handshakes per client IP. Static tokens are not counted. */
export const agentHandshakeLimiter = new LoginRateLimiter(AGENT_WS_HANDSHAKE_MAX_ATTEMPTS)

/**
 * The WebSocket server for /api/agents/ws. ws buffers a whole message before
 * any handler sees it and the path is open to anyone, so the size cap is set
 * on the server itself. The heartbeat of the authenticated sockets runs for as
 * long as the server is open.
 */
export function createAgentWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: AGENT_WS_MAX_PAYLOAD_BYTES })
  startAgentHeartbeat(wss)
  return wss
}

/** One authenticated socket as the heartbeat sees it. */
interface AuthenticatedSocket {
  ws: WebSocket
  agentId: string
  /** False from the moment a ping is sent until its pong arrives. */
  alive: boolean
  /** True when the registry entry of the agentId now belongs to another socket. */
  isReplaced: () => boolean
  replacedClosed: boolean
}

const authenticatedSockets = new Set<AuthenticatedSocket>()
const authenticatedByKey = new Map<string, number>()

/** Sockets currently counted against AGENT_WS_MAX_AUTHENTICATED. */
export function authenticatedSocketCount(): number {
  return authenticatedSockets.size
}

/** Authenticated sockets counted for one client key. */
export function authenticatedKeyCount(key: string): number {
  return authenticatedByKey.get(key) ?? 0
}

/**
 * One heartbeat round over the authenticated sockets. A socket that a newer
 * connection of its agentId replaced is closed with the replaced code (here, a
 * later turn of the event loop than the registration that replaced it, so the
 * interference register() avoids does not apply, and a replaced socket that
 * never sends a snapshot does not stay open). Any other socket that did not
 * answer the previous ping is terminated, which runs the ordinary close path
 * (the agent goes offline); the rest is pinged.
 */
export function runAgentHeartbeat(): void {
  for (const entry of [...authenticatedSockets]) {
    const { ws } = entry
    if (entry.isReplaced()) {
      if (!entry.replacedClosed) {
        entry.replacedClosed = true
        console.warn(`[agent-ws] Closing connection of agent ${entry.agentId}: this connection no longer owns the agent entry`)
        try {
          ws.close(AGENT_WS_REPLACED_CLOSE_CODE, 'Replaced by a newer connection')
        } catch {
          // already closing
        }
      }
      continue
    }
    if (!entry.alive) {
      console.warn(`[agent-ws] Terminating connection of agent ${entry.agentId}: no pong since the last ping`)
      try {
        ws.terminate()
      } catch {
        // already gone
      }
      continue
    }
    entry.alive = false
    try {
      ws.ping()
    } catch {
      // not open any more; the close path follows
    }
  }
}

// One timer serves every server of the process: the authenticated sockets are
// module-global, so a timer per server would run several rounds per interval
// and terminate a socket that was pinged only once.
const heartbeatServers = new Set<WebSocketServer>()
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/**
 * Run the heartbeat every `intervalMs` while `wss` is open. The first open
 * server starts the one shared timer (its interval wins), later ones join it,
 * and the timer stops when the last server closes.
 */
export function startAgentHeartbeat(wss: WebSocketServer, intervalMs: number = AGENT_WS_PING_INTERVAL_MS): void {
  heartbeatServers.add(wss)
  if (heartbeatTimer === null) {
    heartbeatTimer = setInterval(runAgentHeartbeat, intervalMs)
    heartbeatTimer.unref?.()
  }
  wss.once('close', () => {
    heartbeatServers.delete(wss)
    if (heartbeatServers.size === 0 && heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  })
}

let unauthenticated = 0
// Counted sockets per client key and per IPv6 /48 parent (the strings cannot collide).
const unauthenticatedByKey = new Map<string, number>()

/** Sockets currently counted against AGENT_WS_MAX_UNAUTHENTICATED. */
export function unauthenticatedSocketCount(): number {
  return unauthenticated
}

/** Counted sockets of one client key or /48 parent. */
export function unauthenticatedKeyCount(key: string): number {
  return unauthenticatedByKey.get(key) ?? 0
}

function keyHasRoom(client: ClientKeys): boolean {
  if (unauthenticatedKeyCount(client.key) >= AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY) return false
  return client.parent === undefined || unauthenticatedKeyCount(client.parent) < AGENT_WS_MAX_UNAUTHENTICATED_PER_PARENT
}

function adjustKeys(client: ClientKeys, delta: 1 | -1): void {
  for (const k of client.parent === undefined ? [client.key] : [client.key, client.parent]) {
    const n = unauthenticatedKeyCount(k) + delta
    if (n > 0) unauthenticatedByKey.set(k, n)
    else unauthenticatedByKey.delete(k)
  }
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
   * Admit the persisted-token handshake of this socket: charge it to the client
   * IP, and allow one per socket (every outcome but success closes the socket). False means do not go on: the socket is closed
   * with 1008 when the IP's budget is used up, and the message is ignored
   * without closing when this socket already started one (the first decides
   * the outcome, and closing would cut off a handshake that may be about to
   * succeed). Call it before the token store is read.
   */
  admitHandshake(): boolean
  /**
   * Close the socket (as the deadline does): it counts as gone from now on, so
   * any compare loop of it stops, and its slot is freed once its running work
   * has settled. For a handshake that failed.
   */
  close(code: number, reason: string): void
  /**
   * The socket presented a valid token: stop the deadline, free the
   * unauthenticated slot, clear the IP's failures if it was charged, and take
   * an authenticated slot (in total and for the client key). A socket takes one
   * slot at most: every call after the first returns null and changes nothing.
   * Returns null,
   * after closing the socket with 1013, when AGENT_WS_MAX_AUTHENTICATED
   * sockets are already authenticated or the client key holds its share.
   * `isReplaced` tells the heartbeat whether a newer connection took over the
   * agentId. Call it synchronously before registry.register(), with no await
   * in between, so the count and the registration cannot interleave.
   */
  authenticated(agent: { agentId: string; isReplaced: () => boolean }): AuthenticatedSlot | null
  /**
   * Run the processing of one message. The slot of a socket that is gone (or
   * authenticated) is given back only when every message run this way has
   * settled, so the cap also bounds the bcrypt compares still running for
   * sockets that already closed. A rejection of `work` is logged (message
   * only, never the payload) and does not leave an unhandled rejection or
   * keep the slot.
   */
  run(work: () => Promise<void>): void
}

/** The authenticated slot of one socket. */
export interface AuthenticatedSlot {
  /**
   * The registry refused the agent after the slot was taken: give the slot
   * back and close the socket with 1013 (no auth_error, so the reference
   * agent retries).
   */
  refuse(): void
}

/**
 * Count a new socket as unauthenticated. Returns null, after closing the
 * socket with 1013, when AGENT_WS_MAX_UNAUTHENTICATED sockets are already
 * waiting or its client key (or IPv6 /48) holds its share. Otherwise starts
 * the authentication deadline. The slot, global and per client, is given back
 * exactly once: after the first of authentication, close, error or the
 * deadline, and once every message processed with run() has settled.
 */
export function admitUnauthenticated(ws: WebSocket, req: IncomingMessage): PreAuthGuard | null {
  const client = upgradeClientKeys(req)
  if (unauthenticated >= AGENT_WS_MAX_UNAUTHENTICATED || !keyHasRoom(client)) {
    // A socket without an error listener would crash the process on an error event.
    ws.on('error', () => {})
    const cancelReap = closeAndReap(ws, WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
    ws.on('close', cancelReap)
    return null
  }

  unauthenticated += 1
  adjustKeys(client, 1)
  let held = true
  let done = false // closed, rejected or authenticated: no new work is started for the slot
  let inFlight = 0
  let gone = false
  let charged = false
  // A socket gets one persisted-token handshake: every outcome but success closes it.
  let handshakeStarted = false
  let authCalled = false
  let cancelReap: (() => void) | null = null

  const releaseIfIdle = () => {
    if (!held || !done || inFlight > 0) return
    held = false
    unauthenticated -= 1
    adjustKeys(client, -1)
  }
  const finish = () => {
    gone = true
    done = true
    clearTimeout(deadline)
    cancelReap?.()
    releaseIfIdle()
  }
  const reject = (code: number, reason: string) => {
    if (gone) return
    gone = true
    done = true
    clearTimeout(deadline)
    cancelReap = closeAndReap(ws, code, reason)
    releaseIfIdle()
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
      if (handshakeStarted) return false
      const gate = agentHandshakeLimiter.acquire(client.key, client.parent)
      if (!gate.allowed) {
        reject(WS_CLOSE_POLICY, 'Too many attempts')
        return false
      }
      charged = true
      handshakeStarted = true
      return true
    },
    close(code, reason) {
      reject(code, reason)
    },
    run(work) {
      inFlight += 1
      work()
        .catch((err: unknown) => {
          console.warn(`[agent-ws] Message handler failed: ${err instanceof Error ? err.message : 'unknown error'}`)
        })
        .finally(() => {
          inFlight -= 1
          releaseIfIdle()
        })
    },
    authenticated(agent) {
      // One slot per socket: a second call must not take another one.
      if (authCalled) return null
      authCalled = true
      clearTimeout(deadline)
      // The slot is given back when the message that authenticated has settled.
      done = true
      // The token was valid, whatever happens next: it is not a failed guess.
      if (charged) {
        agentHandshakeLimiter.reset(client.key, client.parent)
        agentHandshakeLimiter.recordSuccess(client.key, client.parent)
      }
      if (
        authenticatedSockets.size >= AGENT_WS_MAX_AUTHENTICATED ||
        authenticatedKeyCount(client.key) >= AGENT_WS_MAX_AUTHENTICATED_PER_KEY
      ) {
        console.warn(`[agent-ws] Refusing connection of agent ${agent.agentId}: too many authenticated connections`)
        reject(WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
        return null
      }

      const entry: AuthenticatedSocket = {
        ws,
        agentId: agent.agentId,
        alive: true,
        isReplaced: agent.isReplaced,
        replacedClosed: false,
      }
      authenticatedSockets.add(entry)
      authenticatedByKey.set(client.key, authenticatedKeyCount(client.key) + 1)
      // Given back exactly once, whichever of close and error comes first
      // (ws emits close after error, and terminate() ends in close).
      let released = false
      const release = () => {
        if (released) return
        released = true
        authenticatedSockets.delete(entry)
        const n = authenticatedKeyCount(client.key) - 1
        if (n > 0) authenticatedByKey.set(client.key, n)
        else authenticatedByKey.delete(client.key)
      }
      ws.on('close', release)
      ws.on('error', release)
      ws.on('pong', () => {
        entry.alive = true
      })
      return {
        refuse() {
          release()
          reject(WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
        },
      }
    },
  }
}
