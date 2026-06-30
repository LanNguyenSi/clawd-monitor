/**
 * Unit tests for src/lib/agent-ws-handler.ts – handleAgentConnection
 *
 * Strategy:
 * - Mock @/lib/data-store so readTokens is controlled without hitting the FS.
 * - Mock @/lib/agent-registry to isolate registry side-effects per test.
 * - AGENT_TOKENS is read at module load time, so tests that need a static
 *   token reload the module via vi.resetModules() + dynamic import.
 * - The message handler is async (bcrypt); use vi.waitFor to observe results.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import bcrypt from 'bcryptjs'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

// ── module mocks (hoisted automatically by vitest) ────────────────────────────

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
}))

vi.mock('@/lib/agent-registry', () => {
  const agents = new Map()
  return {
    registry: {
      agents,
      register: vi.fn(),
      update: vi.fn(),
      disconnect: vi.fn(),
      getAll: vi.fn(() => []),
      getAgent: vi.fn(() => null),
      cleanup: vi.fn(),
    },
  }
})

// ── imports (after mock declarations) ────────────────────────────────────────

import { readTokens } from '@/lib/data-store'
import { registry } from '@/lib/agent-registry'

const mockReadTokens = vi.mocked(readTokens)
const mockRegistry = registry as typeof registry & {
  register: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

// ── helpers ───────────────────────────────────────────────────────────────────

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn()
}

function makeMockWs(): MockWs {
  return new MockWs()
}

const fakeReq = {} as IncomingMessage

/** Emit a raw WS message and wait until ws.send has been called at least once. */
async function emitAndWait(ws: MockWs, payload: object): Promise<void> {
  ws.emit('message', Buffer.from(JSON.stringify(payload)))
  await vi.waitFor(
    () => {
      expect(ws.send).toHaveBeenCalled()
    },
    { timeout: 5000 },
  )
}

const AUTH_MSG = {
  type: 'auth' as const,
  token: 'will-be-overridden',
  agentId: 'test-agent-1',
  name: 'Test Agent',
  version: '1.0.0',
}

const SNAPSHOT_MSG = {
  type: 'snapshot' as const,
  data: {
    agentId: 'test-agent-1',
    name: 'Test Agent',
    timestamp: Date.now(),
    version: '1.0.0',
    sessions: [],
    cronJobs: [],
    metrics: { cpuPercent: 0, memUsedBytes: 0, memTotalBytes: 0, uptimeSeconds: 0 },
    memoryFiles: {},
    containers: [],
  },
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('handleAgentConnection – invalid token (no static, no persisted)', () => {
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', '')
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTokens.mockReturnValue([])
  })

  it('sends auth_error and closes the ws when the token is not recognised', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: 'invalid-token' })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledOnce()
  })

  it('sends auth_error when a snapshot is received before auth', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, SNAPSHOT_MSG)

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledOnce()
  })

  it('does not ingest a snapshot received before auth into the registry', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, SNAPSHOT_MSG)

    expect(mockRegistry.update).not.toHaveBeenCalled()
  })
})

describe('handleAgentConnection – valid static env token', () => {
  const STATIC_TOKEN = 'my-static-env-token-abc'
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends auth_ok for a valid static token', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_ok')
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('does not close the ws after a successful static-token auth', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN })

    expect(ws.close).not.toHaveBeenCalled()
  })
})

describe('handleAgentConnection – valid bcrypt persisted token', () => {
  const BCRYPT_PLAINTEXT = 'persisted-bcrypt-token-xyz'
  let bcryptHash: string
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    // Compute a real bcrypt hash; cost factor 4 is the fastest that bcryptjs allows.
    bcryptHash = await bcrypt.hash(BCRYPT_PLAINTEXT, 4)

    vi.stubEnv('AGENT_TOKENS', '') // no static tokens
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  beforeEach(() => {
    vi.clearAllMocks()
    // Return the bcrypt hash entry for this test group
    mockReadTokens.mockReturnValue([
      { id: 'tok-1', name: 'test-token', tokenHash: bcryptHash, createdAt: new Date().toISOString() },
    ])
  })

  it('sends auth_ok when the token matches a persisted bcrypt hash', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_ok')
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('sends auth_error when the token does not match any persisted hash', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: 'wrong-plaintext' })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledOnce()
  })
})

// ── post-auth paths ───────────────────────────────────────────────────────────
//
// These tests cover the branches that execute AFTER a successful auth handshake:
//   snapshot → registry.update + ack
//   ping     → pong
//   close    → registry.disconnect
//   malformed JSON → silent return (no send)
//   valid-JSON but invalid schema shape → {type:'error'} sent

describe('handleAgentConnection – post-auth paths', () => {
  const STATIC_TOKEN = 'post-auth-static-token-abc'
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTokens.mockReturnValue([])
  })

  /**
   * Authenticate the connection, then clear the send spy so subsequent
   * assertions see only the message under test (not the auth_ok).
   */
  async function authenticate(ws: MockWs): Promise<void> {
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)
    await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN })
    ws.send.mockClear()
  }

  it('calls registry.update with the snapshot data and sends {type:ack}', async () => {
    const ws = makeMockWs()
    await authenticate(ws)

    await emitAndWait(ws, SNAPSHOT_MSG)

    expect(mockRegistry.update).toHaveBeenCalledWith('test-agent-1', SNAPSHOT_MSG.data)
    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('ack')
  })

  it('sends {type:pong} for a ping message', async () => {
    const ws = makeMockWs()
    await authenticate(ws)

    await emitAndWait(ws, { type: 'ping' })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('pong')
  })

  it('calls registry.disconnect when the ws closes after auth', async () => {
    const ws = makeMockWs()
    await authenticate(ws)

    // The close handler is synchronous
    ws.emit('close')

    expect(mockRegistry.disconnect).toHaveBeenCalledWith('test-agent-1', expect.anything())
  })

  it('silently returns and sends nothing for malformed JSON', async () => {
    const ws = makeMockWs()
    await authenticate(ws)

    ws.emit('message', Buffer.from('{not json'))
    // Give the async handler a tick to complete before asserting
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(ws.send).not.toHaveBeenCalled()
  })

  it('sends {type:error, message:Invalid message format} for valid-JSON but invalid-schema payload', async () => {
    const ws = makeMockWs()
    await authenticate(ws)

    // {type:'snapshot', data:{}} passes JSON.parse but fails agentSnapshotSchema
    // (missing agentId, name, timestamp, version, metrics)
    await emitAndWait(ws, { type: 'snapshot', data: {} })

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('error')
    expect(sent.message).toBe('Invalid message format')
  })
})
