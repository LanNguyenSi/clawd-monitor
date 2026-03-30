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

export type AgentEntryPublic = Omit<AgentEntry, 'ws' | 'token'>

const AGENT_TTL_MS = parseInt(process.env.AGENT_TTL_MS ?? '300000')

class AgentRegistry {
  agents: Map<string, AgentEntry> = new Map()

  register(ws: WebSocket, meta: { agentId: string; name: string; version: string; token: string; gatewayUrl?: string; gatewayToken?: string }) {
    const existing = this.agents.get(meta.agentId)
    if (existing) {
      // Reconnect — forcibly terminate old connection to avoid triggering reconnect loop
      if (existing.ws !== ws) {
        try { existing.ws.terminate() } catch {}
      }
    }

    this.agents.set(meta.agentId, {
      ...meta,
      connectedAt: Date.now(),
      lastSnapshotAt: 0,
      lastSnapshot: null,
      online: true,
      ws,
    })
  }

  update(agentId: string, snapshot: AgentSnapshot) {
    const entry = this.agents.get(agentId)
    if (!entry) return
    entry.lastSnapshot = snapshot
    entry.lastSnapshotAt = Date.now()
  }

  disconnect(agentId: string) {
    const entry = this.agents.get(agentId)
    if (!entry) return
    entry.online = false
  }

  getAll(): AgentEntryPublic[] {
    this.cleanup()
    return Array.from(this.agents.values()).map(({ ws: _ws, token: _token, ...rest }) => rest)
  }

  getAgent(agentId: string): AgentEntryPublic | null {
    const entry = this.agents.get(agentId)
    if (!entry) return null
    const { ws: _ws, token: _token, ...rest } = entry
    return rest
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
