import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import { registry, type AgentSnapshot } from './agent-registry.js'

const AGENT_TOKENS = (process.env.AGENT_TOKENS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

type WsMsg =
  | { type: 'auth'; token: string; agentId: string; name: string; version: string }
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

  ws.on('message', (raw) => {
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

      // Validate token
      if (!AGENT_TOKENS.includes(msg.token)) {
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
