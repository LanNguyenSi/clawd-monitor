import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import bcrypt from 'bcryptjs'
import { registry } from './agent-registry.js'
import { readTokens, writeTokens, type TokenEntry } from './data-store.js'
import { wsMessageSchema, type ValidatedWsMessage } from './schemas.js'
import { admitUnauthenticated, WS_CLOSE_TRY_AGAIN_LATER } from './agent-ws-limits.js'

// Static tokens from env (for backward compat + default setup)
const STATIC_TOKENS = (process.env.AGENT_TOKENS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

// Application close code (4000-4999 is free for applications) for a socket that
// a newer connection of the same agentId replaced.
export const REPLACED_CLOSE_CODE = 4000

function send(ws: WebSocket, msg: object) {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // connection closed
  }
}

export function handleAgentConnection(ws: WebSocket, req: IncomingMessage) {
  let agentId: string | null = null
  let authenticated = false

  // Bounds what a socket may cost before it authenticates (see agent-ws-limits.ts).
  const guard = admitUnauthenticated(ws, req)
  if (!guard) return

  const onMessage = async (raw: Buffer | string) => {
    // Before authentication a message is size-checked on the raw bytes, before
    // it is parsed, and ignored once the socket was rejected or timed out.
    if (!authenticated && (guard.gone || guard.tooLarge(raw))) return

    let msg: ValidatedWsMessage
    try {
      const parsed = JSON.parse(raw.toString())
      const result = wsMessageSchema.safeParse(parsed)
      if (!result.success) {
        send(ws, { type: 'error', message: 'Invalid message format' })
        return
      }
      msg = result.data
    } catch {
      return
    }

    if (!authenticated) {
      if (msg.type !== 'auth') {
        send(ws, { type: 'auth_error', message: 'Expected auth message first' })
        ws.close()
        return
      }

      // Validate token — check static env tokens first, then persisted tokens.json
      const staticMatch = STATIC_TOKENS.includes(msg.token)
      let tokenValid = staticMatch
      let matched: TokenEntry | null = null
      if (!tokenValid) {
        // Persisted tokens cost a store read and a bcrypt compare each: charge
        // this client's budget first, so a client over it never gets that far.
        if (!guard.admitHandshake()) return
        // A failing store read fails closed: access is denied like for any
        // invalid token, but the client is answered and the socket closed with
        // 1008 instead of left open until it times out. The message stays
        // generic so nothing about the broken store leaks to the client.
        let entries: TokenEntry[]
        try {
          entries = readTokens()
        } catch (err) {
          console.warn(`[agent-ws] Could not read tokens; rejecting handshake: ${err instanceof Error ? err.message : 'unknown error'}`)
          send(ws, { type: 'auth_error', message: 'Invalid token' })
          guard.close(1008, 'Invalid token')
          return
        }
        for (const entry of entries) {
          // A socket that closed (or timed out) while bcrypt ran is not worth
          // another compare: each one is ~100 ms of event loop.
          if (guard.gone) return
          try {
            if (await bcrypt.compare(msg.token, entry.tokenHash)) {
              // Do not bind or stamp a token for a socket that is gone.
              if (guard.gone) return
              tokenValid = true
              matched = entry
              break
            }
          } catch {}
        }
      }

      if (staticMatch) {
        // A static token is shared and unbound, but it must not take over an
        // agentId that a persisted token is bound to: that binding is what
        // keeps one host from replacing another agent's registry entry. The
        // store is read here, at handshake time and synchronously, with no
        // await before registry.register, so a binding created a moment ago
        // counts and nothing is cached across handshakes. A missing
        // tokens.json reads as an empty list (the normal "no persisted
        // tokens" case), so it never locks out a static agent. A store that
        // exists but cannot be read or parsed fails closed: failing open
        // would drop the check exactly when the store is broken. That
        // refusal is temporary and fixable by the operator, so it is
        // answered like the other retryable refusals (close 1013, no
        // auth_error): an auth_error makes the reference agent stop for good,
        // and a transient broken file would then stop every static agent
        // permanently. The agents reconnect with their backoff and recover
        // once the file is fixed. A binding hit is a permanent refusal and
        // answers like an invalid token. The server log names the reason,
        // never the token.
        let entries: TokenEntry[]
        try {
          entries = readTokens()
        } catch (err) {
          console.warn(`[agent-ws] Could not read tokens to check agentId bindings; refusing static-token handshake, try again later: ${err instanceof Error ? err.message : 'unknown error'}`)
          guard.close(WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
          return
        }
        if (entries.some((t) => t.agentId === msg.agentId)) {
          console.warn(`[agent-ws] Auth failed for agentId=${msg.agentId}: a static token cannot claim an agentId bound to a persisted token`)
          tokenValid = false
        }
      }

      if (matched) {
        // The bcrypt loop above yields to the event loop, so the snapshot may
        // be stale. Re-read synchronously and patch only the matched id, with
        // no await between the read and the write, so a token created or
        // revoked meanwhile is neither lost nor resurrected.
        // A failing read rejects the handshake (fail closed): without it a
        // revoked token could not be told apart from a valid one. Only the
        // write stays best effort.
        let fresh: TokenEntry[] = []
        try {
          fresh = readTokens()
        } catch (err) {
          console.warn(`[agent-ws] Could not re-read tokens; rejecting handshake: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
        const current = fresh.find((t) => t.id === matched!.id)
        if (!current) {
          tokenValid = false
        } else if (current.agentId !== undefined && current.agentId !== msg.agentId) {
          // A stored token is bound to the first agentId that used it. Another
          // agentId is answered like an invalid token, so the client learns
          // nothing about the binding; the server log names the mismatch (never
          // the token). The binding is read from the fresh copy, so two
          // handshakes racing on one unbound token cannot both bind.
          console.warn(`[agent-ws] Auth failed for agentId=${msg.agentId}: token "${current.name}" (${current.id}) is bound to another agentId`)
          tokenValid = false
        } else {
          const needsBinding = current.agentId === undefined
          current.lastUsedAt = new Date().toISOString()
          if (needsBinding) current.agentId = msg.agentId
          try {
            writeTokens(fresh)
          } catch (err) {
            // The lastUsedAt stamp is best effort: a read-only data dir must
            // not fail the handshake of an already bound token. A binding
            // that could not be persisted is different: it would silently
            // leave the token usable for any agentId (and for a different one
            // on every restart), so that handshake fails closed. The agent
            // retries once the data dir is writable.
            if (needsBinding) {
              console.warn(`[agent-ws] Could not bind token "${current.name}" (${current.id}) to agentId=${msg.agentId}; rejecting handshake: ${err instanceof Error ? err.message : 'unknown error'}`)
              tokenValid = false
            }
          }
        }
      }

      if (!tokenValid) {
        console.warn(`[agent-ws] Auth failed for agentId=${msg.agentId} — invalid token`)
        send(ws, { type: 'auth_error', message: 'Invalid token' })
        guard.close(1008, 'Invalid token')
        return
      }

      agentId = msg.agentId
      authenticated = true
      guard.authenticated()
      registry.register(ws, {
        agentId: msg.agentId,
        name: msg.name,
        version: msg.version,
        token: msg.token,
        gatewayUrl: msg.gatewayUrl,
        gatewayToken: msg.gatewayToken,
      })

      send(ws, { type: 'auth_ok' })
      console.log(`[agent-ws] Agent connected: "${msg.name}" (${msg.agentId})`)
      return
    }

    if (msg.type === 'snapshot') {
      // Only the socket that owns the registry entry may write to it. A socket
      // that a newer connection replaced is told to go and closed here, on its
      // own next message: the registry never touches the old socket when the
      // new one registers (see register()), and closing it from inside its own
      // message handler is the ordinary path. The close is not an auth_error,
      // so a reconnecting agent retries with its backoff and becomes the
      // current connection again.
      if (!agentId || !registry.update(ws, agentId, msg.data)) {
        console.warn(`[agent-ws] Closing connection of agent ${agentId ?? 'unknown'}: this connection no longer owns the agent entry`)
        ws.close(REPLACED_CLOSE_CODE, 'Replaced by a newer connection')
        return
      }
      send(ws, { type: 'ack' })
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong' })
    }
  }
  // The guard keeps the unauthenticated slot until the work of each message,
  // bcrypt included, has settled, and logs a failing handler.
  ws.on('message', (raw: Buffer | string) => {
    guard.run(() => onMessage(raw))
  })

  ws.on('close', () => {
    if (agentId) {
      registry.disconnect(agentId, ws)
      console.log(`[agent-ws] Agent disconnected: ${agentId}`)
    }
  })

  ws.on('error', (err: Error) => {
    console.warn(`[agent-ws] Error for ${agentId ?? 'unknown'}:`, err.message)
  })
}
