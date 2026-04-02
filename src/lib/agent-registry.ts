import type WebSocket from 'ws'

export interface AgentSnapshot {
  agentId: string
  name: string
  timestamp: number
  version: string
  sessions: unknown[]
  cronJobs: unknown[]
  metrics: {
    cpuPercent: number
    memUsedBytes: number
    memTotalBytes: number
    uptimeSeconds: number
  }
  memoryFiles: {
    memory?: string
    current?: string
    today?: string
  }
  containers: unknown[]
}

export interface AgentEntry {
  agentId: string
  name: string
  version: string
  token: string
  gatewayUrl?: string
  gatewayToken?: string
  connectedAt: number
  lastSnapshotAt: number
  lastSnapshot: AgentSnapshot | null
  online: boolean
  ws: WebSocket
}

export type AgentEntryPublic = Omit<AgentEntry, 'ws' | 'token' | 'gatewayToken'>

const AGENT_TTL_MS = parseInt(process.env.AGENT_TTL_MS ?? '300000')

function toPublicEntry(entry: AgentEntry): AgentEntryPublic {
  return {
    agentId: entry.agentId,
    name: entry.name,
    version: entry.version,
    gatewayUrl: entry.gatewayUrl,
    connectedAt: entry.connectedAt,
    lastSnapshotAt: entry.lastSnapshotAt,
    lastSnapshot: entry.lastSnapshot,
    online: entry.online,
  }
}

class AgentRegistry {
  agents: Map<string, AgentEntry> = new Map()

  register(ws: WebSocket, meta: { agentId: string; name: string; version: string; token: string; gatewayUrl?: string; gatewayToken?: string }) {
    const existing = this.agents.get(meta.agentId)

    // Register the new connection first, THEN close the old one.
    // This ensures the close handler for the old WS sees entry.ws !== oldWs
    // and skips marking the agent offline.
    this.agents.set(meta.agentId, {
      ...meta,
      connectedAt: Date.now(),
      lastSnapshotAt: existing?.lastSnapshotAt ?? 0,
      lastSnapshot: existing?.lastSnapshot ?? null,
      online: true,
      ws,
    })

    // Don't touch the old WebSocket at all — let it close naturally.
    // The disconnect handler checks ws !== entry.ws and skips stale sockets.
    // Calling terminate/close/removeAllListeners on the old WS can interfere
    // with the new connection in the same Node.js event loop.
  }

  update(agentId: string, snapshot: AgentSnapshot) {
    const entry = this.agents.get(agentId)
    if (!entry) return
    entry.lastSnapshot = snapshot
    entry.lastSnapshotAt = Date.now()
    entry.online = true
  }

  disconnect(agentId: string, ws?: WebSocket) {
    const entry = this.agents.get(agentId)
    if (!entry) return
    if (ws && entry.ws !== ws) return
    entry.online = false
  }

  getAll(): AgentEntryPublic[] {
    this.cleanup()
    return Array.from(this.agents.values(), toPublicEntry)
  }

  getAgent(agentId: string): AgentEntryPublic | null {
    const entry = this.agents.get(agentId)
    if (!entry) return null
    return toPublicEntry(entry)
  }

  cleanup() {
    const now = Date.now()
    for (const [id, entry] of this.agents.entries()) {
      if (!entry.online && now - entry.lastSnapshotAt > AGENT_TTL_MS) {
        this.agents.delete(id)
      }
    }
  }
}

// Singleton — always stored on globalThis so both custom server and API routes share the same instance
const globalForRegistry = globalThis as unknown as { agentRegistry?: AgentRegistry }
if (!globalForRegistry.agentRegistry) {
  globalForRegistry.agentRegistry = new AgentRegistry()
}
export const registry = globalForRegistry.agentRegistry
