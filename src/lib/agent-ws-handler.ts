import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import bcrypt from 'bcryptjs'
import { registry, type AgentSnapshot } from './agent-registry.js'
import { readTokens } from './data-store.js'

// Static tokens from env (for backward compat + default setup)
const STATIC_TOKENS = (process.env.AGENT_TOKENS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

type WsMsg =
  | { type: 'auth'; token: string; agentId: string; name: string; version: string; gatewayUrl?: string; gatewayToken?: string }
  | { type: 'snapshot'; data: AgentSnapshot }
  | { type: 'ping' }

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

  ws.on('message', async (raw) => {
    let msg: WsMsg
    try {
      msg = JSON.parse(raw.toString()) as WsMsg
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
      if (!tokenValid) {
        const persistedTokens = readTokens()
        for (const entry of persistedTokens) {
          try {
            if (await bcrypt.compare(msg.token, entry.tokenHash)) {
              tokenValid = true
              break
            }
          } catch {}
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
      registry.disconnect(agentId)
      console.log(`[agent-ws] Agent disconnected: ${agentId}`)
    }
  })

  ws.on('error', (err) => {
    console.warn(`[agent-ws] Error for ${agentId ?? 'unknown'}:`, err.message)
  })
}
