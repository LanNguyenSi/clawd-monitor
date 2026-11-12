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

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import bcrypt from 'bcryptjs'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

// ── module mocks (hoisted automatically by vitest) ────────────────────────────

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
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

import { readTokens, writeTokens } from '@/lib/data-store'
import { registry } from '@/lib/agent-registry'

const mockReadTokens = vi.mocked(readTokens)
const mockWriteTokens = vi.mocked(writeTokens)
const mockRegistry = registry as typeof registry & {
  register: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

// ── helpers ───────────────────────────────────────────────────────────────────

class MockWs extends EventEmitter {
  send = vi.fn()
  // Like a real socket, a closed one ends with a 'close' event; the handler's
  // unauthenticated-socket accounting depends on it.
  close = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
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

  it('logs the store read error message but no token value when the token store read throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockReadTokens.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied, open tokens.json')
      })
      const ws = makeMockWs()
      handleAgentConnection(ws as unknown as WebSocket, fakeReq)
      await emitAndWait(ws, { ...AUTH_MSG, token: 'secret-token-value-123' })

      const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(logged).toContain('Could not read tokens')
      expect(logged).toContain('EACCES: permission denied')
      expect(logged).not.toContain('secret-token-value-123')
    } finally {
      warn.mockRestore()
    }
  })

  it('sends auth_error and closes with 1008 when the token store read throws', async () => {
    mockReadTokens.mockImplementationOnce(() => {
      throw new Error('corrupt tokens.json')
    })
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    // The handler is invoked by ws.emit, which discards its promise, so watch
    // for a rejected handler promise at the process level: before the fix the
    // throwing readTokens() escaped as an unhandled rejection.
    const rejections: unknown[] = []
    const onUnhandledRejection = (err: unknown) => {
      rejections.push(err)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      await emitAndWait(ws, { ...AUTH_MSG, token: 'not-a-static-token' })
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(rejections).toHaveLength(0)

    const sent = JSON.parse(ws.send.mock.calls[0][0] as string)
    expect(sent.type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
    expect(mockRegistry.register).not.toHaveBeenCalled()
    expect(mockWriteTokens).not.toHaveBeenCalled()
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

  it('reads the token store for a static token, to check the agentId bindings', async () => {
    mockReadTokens.mockReturnValue([])
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    expect(mockReadTokens).toHaveBeenCalledTimes(1)
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

  it('stamps lastUsedAt on the matching token entry and persists it', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    expect(mockWriteTokens).toHaveBeenCalledOnce()
    const written = mockWriteTokens.mock.calls[0][0]
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe('tok-1')
    expect(new Date(written[0].lastUsedAt as string).toISOString()).toBe(written[0].lastUsedAt)
  })

  it('still sends auth_ok when persisting lastUsedAt fails for an already bound token', async () => {
    mockReadTokens.mockReturnValue([
      { id: 'tok-1', name: 'test-token', tokenHash: bcryptHash, createdAt: new Date().toISOString(), agentId: AUTH_MSG.agentId },
    ])
    mockWriteTokens.mockImplementationOnce(() => { throw new Error('EROFS') })
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
  })

  it('patches only the matched entry in a fresh read, keeping concurrent token changes', async () => {
    const now = new Date().toISOString()
    const matchedEntry = { id: 'tok-1', name: 'test-token', tokenHash: bcryptHash, createdAt: now }
    const removed = { id: 'tok-gone', name: 'removed', tokenHash: 'x', createdAt: now }
    const added = { id: 'tok-new', name: 'created-meanwhile', tokenHash: 'y', createdAt: now }
    mockReadTokens
      .mockReturnValueOnce([matchedEntry, removed])
      .mockReturnValueOnce([{ ...matchedEntry }, added])
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    expect(mockWriteTokens).toHaveBeenCalledOnce()
    const written = mockWriteTokens.mock.calls[0][0]
    expect(written.map((t) => t.id)).toEqual(['tok-1', 'tok-new'])
    expect(written[0].lastUsedAt).toBeTypeOf('string')
    expect(written[1].lastUsedAt).toBeUndefined()
  })

  it('rejects the handshake and writes nothing when the matched token was revoked meanwhile', async () => {
    mockReadTokens
      .mockReturnValueOnce([{ id: 'tok-1', name: 'test-token', tokenHash: bcryptHash, createdAt: new Date().toISOString() }])
      .mockReturnValueOnce([])
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledOnce()
    expect(mockWriteTokens).not.toHaveBeenCalled()
    expect(mockRegistry.register).not.toHaveBeenCalled()
  })

  it('fails closed when the fresh token re-read throws, and logs the error message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockReadTokens
      .mockReturnValueOnce([{ id: 'tok-1', name: 'test-token', tokenHash: bcryptHash, createdAt: new Date().toISOString() }])
      .mockImplementationOnce(() => { throw new Error('EIO') })
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: BCRYPT_PLAINTEXT })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledOnce()
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
    expect(mockWriteTokens).not.toHaveBeenCalled()
    expect(mockRegistry.register).not.toHaveBeenCalled()
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    warn.mockRestore()
    expect(logged).toContain('Could not re-read tokens')
    expect(logged).toContain('EIO')
  })

  it('does not write tokens when the token does not match', async () => {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)

    await emitAndWait(ws, { ...AUTH_MSG, token: 'wrong-plaintext' })

    expect(mockWriteTokens).not.toHaveBeenCalled()
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

// ── token-to-agentId binding ──────────────────────────────────────────────────
//
// A stored token is bound to the first agentId that uses it. These tests run
// against a small in-memory tokens.json so that a write by one handshake is
// visible to the next read, as on disk.

describe('handleAgentConnection – stored token binding', () => {
  const PLAIN_A = 'binding-token-a'
  const PLAIN_B = 'binding-token-b'
  let hashA: string
  let hashB: string
  let store: Array<Record<string, unknown>>
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    hashA = await bcrypt.hash(PLAIN_A, 4)
    hashB = await bcrypt.hash(PLAIN_B, 4)
    vi.stubEnv('AGENT_TOKENS', '')
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    mockReadTokens.mockReset()
    mockWriteTokens.mockReset()
    mockReadTokens.mockReturnValue([])
  })

  beforeEach(() => {
    vi.clearAllMocks()
    store = [
      { id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c' },
      { id: 'tok-b', name: 'agent-b', tokenHash: hashB, createdAt: 'c' },
    ]
    mockReadTokens.mockImplementation(() => structuredClone(store) as never)
    mockWriteTokens.mockImplementation((tokens) => { store = structuredClone(tokens) as never })
  })

  async function handshake(token: string, agentId: string): Promise<{ ws: MockWs; type: string }> {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)
    await emitAndWait(ws, { ...AUTH_MSG, token, agentId })
    return { ws, type: JSON.parse(ws.send.mock.calls[0][0] as string).type }
  }

  it('binds an unbound token to the agentId of its first handshake and persists it', async () => {
    const { type } = await handshake(PLAIN_A, 'agent-a')

    expect(type).toBe('auth_ok')
    expect(store.find((t) => t.id === 'tok-a')?.agentId).toBe('agent-a')
    expect(store.find((t) => t.id === 'tok-b')?.agentId).toBeUndefined()
    expect(mockWriteTokens).toHaveBeenCalledOnce()
  })

  it('lets the bound agentId reconnect and keeps the binding', async () => {
    await handshake(PLAIN_A, 'agent-a')
    const { type, ws } = await handshake(PLAIN_A, 'agent-a')

    expect(type).toBe('auth_ok')
    expect(ws.close).not.toHaveBeenCalled()
    expect(store.find((t) => t.id === 'tok-a')?.agentId).toBe('agent-a')
    expect(mockRegistry.register).toHaveBeenCalledTimes(2)
  })

  it('rejects a bound token presented with another agentId and leaves the registry alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await handshake(PLAIN_A, 'agent-a')
    mockRegistry.register.mockClear()
    mockWriteTokens.mockClear()

    const { type, ws } = await handshake(PLAIN_A, 'victim-agent')
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    warn.mockRestore()

    expect(type).toBe('auth_error')
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).message).toBe('Invalid token')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockRegistry.register).not.toHaveBeenCalled()
    expect(mockWriteTokens).not.toHaveBeenCalled()
    expect(store.find((t) => t.id === 'tok-a')?.agentId).toBe('agent-a')
    expect(logged).toContain('bound to another agentId')
    expect(logged).not.toContain(PLAIN_A)
  })

  it('binds each token separately: a second token may take another agentId', async () => {
    await handshake(PLAIN_A, 'agent-a')
    const { type } = await handshake(PLAIN_B, 'agent-b')

    expect(type).toBe('auth_ok')
    expect(store.map((t) => t.agentId)).toEqual(['agent-a', 'agent-b'])
  })

  it('binds a recreated token fresh after the bound one was revoked', async () => {
    store = [{ id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c', agentId: 'agent-a' }]
    const { type } = await handshake(PLAIN_A, 'agent-a')
    expect(type).toBe('auth_ok')

    // revoke, then create a new token for the same agent: it starts unbound
    store = [{ id: 'tok-a2', name: 'agent-a again', tokenHash: hashA, createdAt: 'c' }]
    const again = await handshake(PLAIN_A, 'agent-a-renamed')
    expect(again.type).toBe('auth_ok')
    expect(store[0].agentId).toBe('agent-a-renamed')
  })

  it('does not make the binding unique: an unbound token may take an agentId bound to another token', async () => {
    await handshake(PLAIN_A, 'shared-agent')
    const { type } = await handshake(PLAIN_B, 'shared-agent')

    expect(type).toBe('auth_ok')
    expect(store.map((t) => t.agentId)).toEqual(['shared-agent', 'shared-agent'])
  })

  it('refuses a token whose stored agentId is the empty string (fail closed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store = [{ id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c', agentId: '' }]

    const { type, ws } = await handshake(PLAIN_A, 'agent-a')
    warn.mockRestore()

    expect(type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockRegistry.register).not.toHaveBeenCalled()
    expect(store[0].agentId).toBe('')
  })

  it('lets only the first of two racing handshakes bind an unbound token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wsFirst = makeMockWs()
    const wsSecond = makeMockWs()
    handleAgentConnection(wsFirst as unknown as WebSocket, fakeReq)
    handleAgentConnection(wsSecond as unknown as WebSocket, fakeReq)
    wsFirst.emit('message', Buffer.from(JSON.stringify({ ...AUTH_MSG, token: PLAIN_A, agentId: 'first' })))
    wsSecond.emit('message', Buffer.from(JSON.stringify({ ...AUTH_MSG, token: PLAIN_A, agentId: 'second' })))
    await vi.waitFor(() => {
      expect(wsFirst.send).toHaveBeenCalled()
      expect(wsSecond.send).toHaveBeenCalled()
    }, { timeout: 5000 })
    warn.mockRestore()

    const types = [wsFirst, wsSecond].map((w) => JSON.parse(w.send.mock.calls[0][0] as string).type)
    expect(types.filter((t) => t === 'auth_ok')).toHaveLength(1)
    expect(types.filter((t) => t === 'auth_error')).toHaveLength(1)
    expect(mockRegistry.register).toHaveBeenCalledOnce()
    expect(store[0].agentId).toBe(mockRegistry.register.mock.calls[0][1].agentId)
  })

  it('keeps a binding written by another handshake during the bcrypt wait (fresh read decides)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The first read (before bcrypt) sees the token unbound; by the second read
    // another handshake has bound it to a different agentId.
    mockReadTokens
      .mockReturnValueOnce([{ id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c' }])
      .mockReturnValueOnce([{ id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c', agentId: 'other' }])

    const { type } = await handshake(PLAIN_A, 'agent-a')
    warn.mockRestore()

    expect(type).toBe('auth_error')
    expect(mockWriteTokens).not.toHaveBeenCalled()
    expect(mockRegistry.register).not.toHaveBeenCalled()
  })

  it('fails closed when the binding cannot be persisted, and names the cause in the log only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockWriteTokens.mockImplementationOnce(() => { throw new Error('EROFS') })

    const { type, ws } = await handshake(PLAIN_A, 'agent-a')
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    warn.mockRestore()

    expect(type).toBe('auth_error')
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).message).toBe('Invalid token')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockRegistry.register).not.toHaveBeenCalled()
    expect(logged).toContain('Could not bind token')
    expect(logged).toContain('EROFS')
    expect(logged).not.toContain(PLAIN_A)
  })

  it('still accepts an already bound token when only the lastUsedAt write fails', async () => {
    store = [{ id: 'tok-a', name: 'agent-a', tokenHash: hashA, createdAt: 'c', agentId: 'agent-a' }]
    mockWriteTokens.mockImplementationOnce(() => { throw new Error('EROFS') })

    const { type } = await handshake(PLAIN_A, 'agent-a')

    expect(type).toBe('auth_ok')
    expect(mockRegistry.register).toHaveBeenCalledOnce()
  })
})

describe('handleAgentConnection – static token is not bound', () => {
  const STATIC_TOKEN = 'static-shared-token'
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

  it('accepts one static token for several agentIds and never writes the store', async () => {
    for (const agentId of ['host-1', 'host-2', 'host-1']) {
      const ws = makeMockWs()
      handleAgentConnection(ws as unknown as WebSocket, fakeReq)
      await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN, agentId })
      expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    }

    expect(mockRegistry.register).toHaveBeenCalledTimes(3)
    expect(mockWriteTokens).not.toHaveBeenCalled()
  })
})

describe('handleAgentConnection – static token and agentIds bound to a persisted token', () => {
  const STATIC_TOKEN = 'static-vs-binding-token'
  const BOUND_ID = 'victim-agent'
  let store: Array<Record<string, unknown>>
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
    vi.resetModules()
    const mod = await import('@/lib/agent-ws-handler')
    handleAgentConnection = mod.handleAgentConnection
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    mockReadTokens.mockReset()
    mockReadTokens.mockReturnValue([])
  })

  beforeEach(() => {
    vi.clearAllMocks()
    store = [
      { id: 'tok-bound', name: 'victim', tokenHash: 'h1', createdAt: 'c', agentId: BOUND_ID },
      { id: 'tok-unbound', name: 'unused', tokenHash: 'h2', createdAt: 'c' },
    ]
    mockReadTokens.mockImplementation(() => structuredClone(store) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function handshake(agentId: string): Promise<{ ws: MockWs; type: string }> {
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)
    await emitAndWait(ws, { ...AUTH_MSG, token: STATIC_TOKEN, agentId })
    return { ws, type: JSON.parse(ws.send.mock.calls[0][0] as string).type }
  }

  it('rejects a static token claiming an agentId bound to a persisted token, answers like an invalid token and leaves the registry alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ws } = await handshake(BOUND_ID)

    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toEqual({ type: 'auth_error', message: 'Invalid token' })
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockRegistry.register).not.toHaveBeenCalled()
    expect(mockRegistry.update).not.toHaveBeenCalled()
    expect(mockRegistry.disconnect).not.toHaveBeenCalled()
    expect(mockWriteTokens).not.toHaveBeenCalled()
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain(BOUND_ID)
    expect(logged).toContain('bound to a persisted token')
    expect(logged).not.toContain(STATIC_TOKEN)
  })

  it('accepts a static token for an agentId no persisted token is bound to', async () => {
    const { ws, type } = await handshake('some-other-host')

    expect(type).toBe('auth_ok')
    expect(ws.close).not.toHaveBeenCalled()
    expect(mockRegistry.register).toHaveBeenCalledOnce()
  })

  it('accepts a static token for the agentId of an entry that has no binding', async () => {
    // 'unused' is the name of an unbound entry, not a binding: only agentId counts
    for (const agentId of ['unused', 'tok-unbound']) {
      const { type } = await handshake(agentId)
      expect(type).toBe('auth_ok')
    }
    expect(mockRegistry.register).toHaveBeenCalledTimes(2)
  })

  it('counts a binding created between two handshakes (read at handshake time, not cached)', async () => {
    expect((await handshake('late-agent')).type).toBe('auth_ok')

    store.push({ id: 'tok-late', name: 'late', tokenHash: 'h3', createdAt: 'c', agentId: 'late-agent' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ws, type } = await handshake('late-agent')

    expect(type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockRegistry.register).toHaveBeenCalledTimes(1)
  })

  it('accepts when there are no persisted tokens at all (empty store)', async () => {
    store = []
    expect((await handshake(BOUND_ID)).type).toBe('auth_ok')
  })

  it('fails closed with a retryable close, and no auth_error, when the token store cannot be read; logs the cause but not the token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockReadTokens.mockImplementation(() => {
      throw new Error('tokens.json: not valid JSON')
    })
    const ws = makeMockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)
    ws.emit('message', Buffer.from(JSON.stringify({ ...AUTH_MSG, token: STATIC_TOKEN, agentId: 'some-other-host' })))
    await vi.waitFor(() => expect(ws.close).toHaveBeenCalled(), { timeout: 5000 })

    // auth_error would make the reference agent stop for good; 1013 makes it retry
    expect(ws.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(ws.send).not.toHaveBeenCalled()
    expect(mockRegistry.register).not.toHaveBeenCalled()
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('not valid JSON')
    expect(logged).not.toContain(STATIC_TOKEN)
  })

  it('recovers on the next handshake once the store is readable again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockReadTokens.mockImplementationOnce(() => {
      throw new Error('EACCES')
    })
    const refused = makeMockWs()
    handleAgentConnection(refused as unknown as WebSocket, fakeReq)
    refused.emit('message', Buffer.from(JSON.stringify({ ...AUTH_MSG, token: STATIC_TOKEN })))
    await vi.waitFor(() => expect(refused.close).toHaveBeenCalledWith(1013, 'Server busy'), { timeout: 5000 })

    expect((await handshake('test-agent-1')).type).toBe('auth_ok')
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
