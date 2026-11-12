import type WebSocket from 'ws'
import type { ValidatedSnapshot } from './schemas.js'

export type AgentSnapshot = ValidatedSnapshot

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

export const DEFAULT_AGENT_TTL_MS = 300000

export function parseAgentTtlMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_AGENT_TTL_MS
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed)
    if (value > 0) return value
  }
  console.warn(
    `agent-registry: invalid AGENT_TTL_MS ${JSON.stringify(raw)}, using the default ${DEFAULT_AGENT_TTL_MS} ms`,
  )
  return DEFAULT_AGENT_TTL_MS
}

const AGENT_TTL_MS = parseAgentTtlMs(process.env.AGENT_TTL_MS)

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
    // The old socket cannot write any more, though: update() ignores a socket
    // that is not entry.ws, and the handler closes it on its next snapshot.
  }

  /**
   * Store a snapshot for the agent, but only when `ws` is the socket that
   * currently owns the entry. A socket that a newer connection replaced keeps
   * its closure over the agentId, so without this check it would keep
   * overwriting the current connection's data. Returns false when nothing was
   * stored (unknown agent or replaced socket); the caller then closes the
   * replaced socket. The socket is a required argument so a call site cannot
   * skip the check.
   */
  update(ws: WebSocket, agentId: string, snapshot: AgentSnapshot): boolean {
    const entry = this.agents.get(agentId)
    if (!entry || entry.ws !== ws) return false
    entry.lastSnapshot = snapshot
    entry.lastSnapshotAt = Date.now()
    entry.online = true
    return true
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

  /** Remove an offline agent from the registry. Returns 'removed', 'not_found' or 'online' (refused). */
  remove(agentId: string): 'removed' | 'not_found' | 'online' {
    const entry = this.agents.get(agentId)
    if (!entry) return 'not_found'
    if (entry.online) return 'online'
    this.agents.delete(agentId)
    return 'removed'
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
