import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import bcrypt from 'bcryptjs'
import { registry } from './agent-registry.js'
import { readTokens, writeTokens, type TokenEntry } from './data-store.js'
import { wsMessageSchema, type ValidatedWsMessage } from './schemas.js'

// Static tokens from env (for backward compat + default setup)
const STATIC_TOKENS = (process.env.AGENT_TOKENS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

function send(ws: WebSocket, msg: object) {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // connection closed
  }
}

export function handleAgentConnection(ws: WebSocket, _req: IncomingMessage) {
  let agentId: string | null = null
  let authenticated = false

  ws.on('message', async (raw: Buffer | string) => {
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
      let tokenValid = STATIC_TOKENS.includes(msg.token)
      let matched: TokenEntry | null = null
      if (!tokenValid) {
        // A failing store read fails closed: access is denied like for any
        // invalid token, but the client is answered and the socket closed with
        // 1008 instead of left open until it times out. The message stays
        // generic so nothing about the broken store leaks to the client.
        let entries: TokenEntry[]
        try {
          entries = readTokens()
        } catch {
          console.warn('[agent-ws] Could not read tokens; rejecting handshake')
          send(ws, { type: 'auth_error', message: 'Invalid token' })
          ws.close(1008, 'Invalid token')
          return
        }
        for (const entry of entries) {
          try {
            if (await bcrypt.compare(msg.token, entry.tokenHash)) {
              tokenValid = true
              matched = entry
              break
            }
          } catch {}
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
        } catch {
          console.warn('[agent-ws] Could not re-read tokens; rejecting handshake')
        }
        const current = fresh.find((t) => t.id === matched!.id)
        if (!current) {
          tokenValid = false
        } else {
          current.lastUsedAt = new Date().toISOString()
          try {
            writeTokens(fresh)
          } catch {
            // best effort: a read-only data dir must not fail the handshake
          }
        }
      }

      if (!tokenValid) {
        console.warn(`[agent-ws] Auth failed for agentId=${msg.agentId} — invalid token`)
        send(ws, { type: 'auth_error', message: 'Invalid token' })
        ws.close()
        return
      }

      agentId = msg.agentId
      authenticated = true
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
      if (agentId) registry.update(agentId, msg.data)
      send(ws, { type: 'ack' })
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong' })
    }
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
