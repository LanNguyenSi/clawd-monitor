/**
 * Unit tests for src/lib/schemas.ts
 *
 * Direct schema validation — no ws handler involved.
 * Tests both success and failure (edge/rejection) branches.
 */

import { describe, it, expect } from 'vitest'
import {
  agentSnapshotSchema,
  wsMessageSchema,
} from '@/lib/schemas'

// ── shared fixtures ────────────────────────────────────────────────────────────

const VALID_AUTH = {
  type: 'auth' as const,
  token: 'my-token',
  agentId: 'agent-1',
  name: 'My Agent',
  version: '1.0.0',
}

const VALID_METRICS = {
  cpuPercent: 10.5,
  memUsedBytes: 1024,
  memTotalBytes: 4096,
  uptimeSeconds: 3600,
}

const VALID_SNAPSHOT_DATA = {
  agentId: 'agent-1',
  name: 'My Agent',
  timestamp: Date.now(),
  version: '1.0.0',
  metrics: VALID_METRICS,
}

// ── wsMessageSchema – success paths ───────────────────────────────────────────

describe('wsMessageSchema – success paths', () => {
  it('accepts a valid auth message', () => {
    const result = wsMessageSchema.safeParse(VALID_AUTH)
    expect(result.success).toBe(true)
  })

  it('accepts a valid auth message with optional gatewayUrl and gatewayToken', () => {
    const result = wsMessageSchema.safeParse({
      ...VALID_AUTH,
      gatewayUrl: 'https://gw.example.com',
      gatewayToken: 'gw-tok',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid snapshot message', () => {
    const result = wsMessageSchema.safeParse({
      type: 'snapshot',
      data: VALID_SNAPSHOT_DATA,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid ping message', () => {
    const result = wsMessageSchema.safeParse({ type: 'ping' })
    expect(result.success).toBe(true)
  })
})

// ── wsMessageSchema – rejection paths ─────────────────────────────────────────

describe('wsMessageSchema – rejection paths', () => {
  it('rejects auth with an empty token (min(1))', () => {
    const result = wsMessageSchema.safeParse({ ...VALID_AUTH, token: '' })
    expect(result.success).toBe(false)
  })

  it('rejects auth with a missing agentId', () => {
    const { agentId: _drop, ...noAgentId } = VALID_AUTH
    const result = wsMessageSchema.safeParse(noAgentId)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown type discriminant', () => {
    const result = wsMessageSchema.safeParse({ type: 'bogus' })
    expect(result.success).toBe(false)
  })

  it('rejects snapshot with a non-number cpuPercent in metrics', () => {
    const result = wsMessageSchema.safeParse({
      type: 'snapshot',
      data: {
        ...VALID_SNAPSHOT_DATA,
        metrics: { cpuPercent: 'not-a-number', memUsedBytes: 0, memTotalBytes: 0, uptimeSeconds: 0 },
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects snapshot with missing required metrics', () => {
    const result = wsMessageSchema.safeParse({
      type: 'snapshot',
      data: { ...VALID_SNAPSHOT_DATA, metrics: undefined },
    })
    expect(result.success).toBe(false)
  })
})

// ── agentSnapshotSchema – default values ──────────────────────────────────────

describe('agentSnapshotSchema – defaults applied when optional fields are omitted', () => {
  it('applies default empty array for sessions', () => {
    const result = agentSnapshotSchema.safeParse(VALID_SNAPSHOT_DATA)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.sessions).toEqual([])
  })

  it('applies default empty array for cronJobs', () => {
    const result = agentSnapshotSchema.safeParse(VALID_SNAPSHOT_DATA)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cronJobs).toEqual([])
  })

  it('applies default empty array for containers', () => {
    const result = agentSnapshotSchema.safeParse(VALID_SNAPSHOT_DATA)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.containers).toEqual([])
  })

  it('applies default empty object for memoryFiles', () => {
    const result = agentSnapshotSchema.safeParse(VALID_SNAPSHOT_DATA)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.memoryFiles).toEqual({})
  })

  it('preserves explicitly provided optional fields', () => {
    const result = agentSnapshotSchema.safeParse({
      ...VALID_SNAPSHOT_DATA,
      sessions: [{ id: 's1' }],
      memoryFiles: { memory: 'some-content' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessions).toEqual([{ id: 's1' }])
      expect(result.data.memoryFiles.memory).toBe('some-content')
    }
  })
})
