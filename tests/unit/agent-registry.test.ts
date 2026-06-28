/**
 * Unit tests for src/lib/agent-registry.ts
 *
 * The exported `registry` is a globalThis singleton. We clear registry.agents
 * before each test to get a clean slate without module reloading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registry } from '@/lib/agent-registry'
import type { AgentSnapshot } from '@/lib/agent-registry'
import type WebSocket from 'ws'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as WebSocket
}

function makeMeta(agentId: string) {
  return {
    agentId,
    name: `Agent ${agentId}`,
    version: '1.0.0',
    token: `token-${agentId}`,
    gatewayUrl: 'https://gw.example.com',
    gatewayToken: 'gw-secret',
  }
}

function makeSnapshot(agentId: string): AgentSnapshot {
  return {
    agentId,
    name: `Agent ${agentId}`,
    timestamp: Date.now(),
    version: '1.0.0',
    sessions: [],
    cronJobs: [],
    metrics: { cpuPercent: 5, memUsedBytes: 100, memTotalBytes: 1000, uptimeSeconds: 60 },
    memoryFiles: { memory: 'some memory' },
    containers: [],
  }
}

beforeEach(() => {
  registry.agents.clear()
})

// ── register ──────────────────────────────────────────────────────────────────

describe('register', () => {
  it('creates a new entry with online=true', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-1'))

    expect(registry.agents.has('agent-1')).toBe(true)
    const entry = registry.agents.get('agent-1')!
    expect(entry.online).toBe(true)
    expect(entry.ws).toBe(ws)
    expect(entry.agentId).toBe('agent-1')
    expect(entry.name).toBe('Agent agent-1')
    expect(entry.token).toBe('token-agent-1')
    expect(entry.gatewayToken).toBe('gw-secret')
  })

  it('sets connectedAt to approximately now', () => {
    const before = Date.now()
    registry.register(makeMockWs(), makeMeta('agent-2'))
    const after = Date.now()
    const entry = registry.agents.get('agent-2')!
    expect(entry.connectedAt).toBeGreaterThanOrEqual(before)
    expect(entry.connectedAt).toBeLessThanOrEqual(after)
  })

  it('initialises lastSnapshotAt to 0 and lastSnapshot to null for a new agent', () => {
    registry.register(makeMockWs(), makeMeta('agent-new'))
    const entry = registry.agents.get('agent-new')!
    expect(entry.lastSnapshotAt).toBe(0)
    expect(entry.lastSnapshot).toBeNull()
  })

  it('preserves lastSnapshot / lastSnapshotAt on reconnect', () => {
    const ws1 = makeMockWs()
    registry.register(ws1, makeMeta('agent-r'))
    const snap = makeSnapshot('agent-r')
    registry.update('agent-r', snap)

    const ws2 = makeMockWs()
    registry.register(ws2, makeMeta('agent-r'))

    const entry = registry.agents.get('agent-r')!
    expect(entry.lastSnapshot).toBe(snap)
    expect(entry.lastSnapshotAt).toBeGreaterThan(0)
    expect(entry.online).toBe(true)
    expect(entry.ws).toBe(ws2)
  })

  it('sets entry.ws to the NEW ws BEFORE the old ws can disconnect', () => {
    const ws1 = makeMockWs()
    registry.register(ws1, makeMeta('agent-recon'))

    const ws2 = makeMockWs()
    registry.register(ws2, makeMeta('agent-recon'))

    // Simulate old ws closing AFTER the new one registered — must NOT mark offline
    registry.disconnect('agent-recon', ws1)

    expect(registry.agents.get('agent-recon')!.online).toBe(true)
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  it('stores the snapshot and sets online=true', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-u'))
    const snap = makeSnapshot('agent-u')
    registry.update('agent-u', snap)

    const entry = registry.agents.get('agent-u')!
    expect(entry.lastSnapshot).toBe(snap)
    expect(entry.online).toBe(true)
    expect(entry.lastSnapshotAt).toBeGreaterThan(0)
  })

  it('is a no-op for an unknown agentId', () => {
    // Should not throw
    expect(() => registry.update('ghost-agent', makeSnapshot('ghost-agent'))).not.toThrow()
  })
})

// ── disconnect ────────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('marks the agent offline when called with the current ws', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-d'))
    registry.disconnect('agent-d', ws)

    expect(registry.agents.get('agent-d')!.online).toBe(false)
  })

  it('does NOT mark the agent offline when called with a stale (replaced) ws', () => {
    const ws1 = makeMockWs()
    registry.register(ws1, makeMeta('agent-stale'))

    const ws2 = makeMockWs()
    registry.register(ws2, makeMeta('agent-stale'))

    registry.disconnect('agent-stale', ws1) // stale ws

    expect(registry.agents.get('agent-stale')!.online).toBe(true)
  })

  it('marks the agent offline when no ws argument is provided', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-no-ws'))
    registry.disconnect('agent-no-ws')

    expect(registry.agents.get('agent-no-ws')!.online).toBe(false)
  })

  it('is a no-op for an unknown agentId', () => {
    expect(() => registry.disconnect('nobody')).not.toThrow()
  })
})

// ── cleanup ───────────────────────────────────────────────────────────────────

describe('cleanup', () => {
  it('evicts offline agents whose lastSnapshotAt is past the TTL', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-evict'))
    registry.disconnect('agent-evict', ws)

    // Back-date the snapshot timestamp so it is well past the TTL
    registry.agents.get('agent-evict')!.lastSnapshotAt = Date.now() - 999_999

    registry.cleanup()

    expect(registry.agents.has('agent-evict')).toBe(false)
  })

  it('keeps online agents regardless of their lastSnapshotAt age', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-keep-online'))
    registry.agents.get('agent-keep-online')!.lastSnapshotAt = Date.now() - 999_999
    // online = true (not disconnected)

    registry.cleanup()

    expect(registry.agents.has('agent-keep-online')).toBe(true)
  })

  it('keeps offline agents that are within the TTL window', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('agent-keep-recent'))
    registry.disconnect('agent-keep-recent', ws)
    // lastSnapshotAt defaults to 0, but set it to now so it is recent
    registry.agents.get('agent-keep-recent')!.lastSnapshotAt = Date.now()

    registry.cleanup()

    expect(registry.agents.has('agent-keep-recent')).toBe(true)
  })
})

// ── getAll / getAgent ─────────────────────────────────────────────────────────

describe('getAll', () => {
  it('returns public entries for all registered agents', () => {
    registry.register(makeMockWs(), makeMeta('ga-1'))
    registry.register(makeMockWs(), makeMeta('ga-2'))

    const all = registry.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.agentId).sort()).toEqual(['ga-1', 'ga-2'])
  })

  it('triggers cleanup and removes expired offline entries', () => {
    const ws = makeMockWs()
    registry.register(ws, makeMeta('ga-stale'))
    registry.disconnect('ga-stale', ws)
    registry.agents.get('ga-stale')!.lastSnapshotAt = Date.now() - 999_999

    const all = registry.getAll()
    expect(all.find((e) => e.agentId === 'ga-stale')).toBeUndefined()
  })
})

describe('getAgent', () => {
  it('returns the public entry for a known agentId', () => {
    registry.register(makeMockWs(), makeMeta('gg-1'))
    const pub = registry.getAgent('gg-1')
    expect(pub).not.toBeNull()
    expect(pub!.agentId).toBe('gg-1')
  })

  it('returns null for an unknown agentId', () => {
    expect(registry.getAgent('nobody')).toBeNull()
  })
})

// ── toPublicEntry (verified via getAll / getAgent) ────────────────────────────

describe('toPublicEntry – field stripping', () => {
  it('strips the ws field from public entries', () => {
    registry.register(makeMockWs(), makeMeta('strip-1'))
    const pub = registry.getAgent('strip-1')!
    expect(pub).not.toHaveProperty('ws')
  })

  it('strips the token field from public entries', () => {
    registry.register(makeMockWs(), makeMeta('strip-2'))
    const pub = registry.getAgent('strip-2')!
    expect(pub).not.toHaveProperty('token')
  })

  it('strips the gatewayToken field from public entries', () => {
    registry.register(makeMockWs(), makeMeta('strip-3'))
    const pub = registry.getAgent('strip-3')!
    expect(pub).not.toHaveProperty('gatewayToken')
  })

  it('exposes gatewayUrl (not a secret) in public entries', () => {
    registry.register(makeMockWs(), makeMeta('strip-4'))
    const pub = registry.getAgent('strip-4')!
    expect(pub.gatewayUrl).toBe('https://gw.example.com')
  })
})
