/**
 * Unit tests for src/lib/agent-ws-limits.ts as wired into
 * src/lib/agent-ws-handler.ts: the limits that hold before a socket has
 * authenticated (message size, deadline, cap on unauthenticated sockets,
 * per-IP handshake budget), plus one run against a real ws server.
 *
 * The limiter state and the socket counter are module state, so each test
 * loads fresh copies of the modules (vi.resetModules + dynamic import).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import bcrypt from 'bcryptjs'
import WebSocket, { type WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({
  registry: {
    register: vi.fn(),
    update: vi.fn(() => true),
    disconnect: vi.fn(),
  },
}))

import { readTokens, writeTokens } from '@/lib/data-store'
import { registry } from '@/lib/agent-registry'

const mockReadTokens = vi.mocked(readTokens)
const mockWriteTokens = vi.mocked(writeTokens)
const mockRegister = vi.mocked(registry.register)

type Handler = (ws: WebSocket, req: IncomingMessage) => void
type Limits = typeof import('@/lib/agent-ws-limits')

const STATIC_TOKEN = 'static-env-token'

// When set, a closed mock ends with a 'close' event like a real socket does.
let autoClose = false

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn<(code?: number, reason?: string) => void>(() => {
    if (autoClose) queueMicrotask(() => this.emit('close'))
  })
  terminate = vi.fn()
}

const asWs = (ws: MockWs) => ws as unknown as WebSocket

function reqFrom(peer?: string, forwarded?: string): IncomingMessage {
  return {
    socket: peer ? { remoteAddress: peer } : undefined,
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  } as unknown as IncomingMessage
}

const AUTH = { type: 'auth', agentId: 'agent-1', name: 'Agent', version: '1.0.0' }
const authWith = (token: string) => Buffer.from(JSON.stringify({ ...AUTH, token }))

let handle: Handler
let limits: Limits

async function load(env: Record<string, string> = {}) {
  vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
  vi.stubEnv('TRUSTED_PROXY_HOPS', '')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.resetModules()
  limits = await import('@/lib/agent-ws-limits')
  handle = (await import('@/lib/agent-ws-handler')).handleAgentConnection
}

/** Open a socket and send one message; resolves once the handler had a chance to answer. */
async function connect(peer: string | null = '10.0.0.1', forwarded?: string): Promise<MockWs> {
  const ws = new MockWs()
  handle(asWs(ws), reqFrom(peer ?? undefined, forwarded))
  return ws
}

async function authenticate(ws: MockWs, token = STATIC_TOKEN) {
  ws.emit('message', authWith(token))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalled(), { timeout: 5000 })
}

/** Let pending handler promises settle (the slot of a finished message is given back then). */
async function flush() {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  else await new Promise<void>((r) => setTimeout(r, 0))
}

const sentTypes = (ws: MockWs) => ws.send.mock.calls.map((c) => JSON.parse(c[0] as string).type)

beforeEach(() => {
  autoClose = false
  vi.clearAllMocks()
  mockReadTokens.mockReturnValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('pre-auth message size', () => {
  it('closes with 1009 and never parses a pre-auth message over the limit', async () => {
    await load()
    const parse = vi.spyOn(JSON, 'parse')
    try {
      const ws = await connect()
      const big = Buffer.from(JSON.stringify({ ...AUTH, token: 'x'.repeat(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES) }))
      expect(big.length).toBeGreaterThan(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES)
      ws.emit('message', big)
      await new Promise<void>((r) => setTimeout(r, 20))

      expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_TOO_BIG, expect.any(String))
      expect(parse.mock.calls.some((c) => String(c[0]).length > limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES)).toBe(false)
      expect(ws.send).not.toHaveBeenCalled()
      expect(mockReadTokens).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it('also measures a string message by bytes', async () => {
    await load()
    const ws = await connect()
    // 5,000 two-byte characters: under the limit counted in characters, over it counted in bytes.
    ws.emit('message', 'é'.repeat(5000))
    await new Promise<void>((r) => setTimeout(r, 20))
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_TOO_BIG, expect.any(String))
  })

  it('still processes an auth message at the limit', async () => {
    await load()
    const ws = await connect()
    const base = Buffer.from(JSON.stringify({ ...AUTH, token: STATIC_TOKEN, gatewayToken: '' })).length
    const pad = limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES - base
    const msg = Buffer.from(JSON.stringify({ ...AUTH, token: STATIC_TOKEN, gatewayToken: 'g'.repeat(pad) }))
    expect(msg.length).toBe(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES)
    ws.emit('message', msg)
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled())
    expect(sentTypes(ws)).toEqual(['auth_ok'])
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('accepts a snapshot over the pre-auth limit after authentication', async () => {
    await load()
    const ws = await connect()
    await authenticate(ws)
    ws.send.mockClear()
    const snapshot = {
      type: 'snapshot',
      data: {
        agentId: 'agent-1',
        name: 'Agent',
        timestamp: 1,
        version: '1.0.0',
        metrics: { cpuPercent: 0, memUsedBytes: 0, memTotalBytes: 0, uptimeSeconds: 0 },
        memoryFiles: { memory: 'm'.repeat(40 * 1024) },
      },
    }
    ws.emit('message', Buffer.from(JSON.stringify(snapshot)))
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled())
    expect(sentTypes(ws)).toEqual(['ack'])
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('keeps the server-wide payload limit above the pre-auth limit and above the largest reference snapshot', async () => {
    await load()
    expect(limits.AGENT_WS_MAX_PAYLOAD_BYTES).toBeGreaterThan(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES)
    expect(limits.AGENT_WS_MAX_PAYLOAD_BYTES).toBeGreaterThanOrEqual(1024 * 1024)
  })
})

describe('authentication deadline', () => {
  it('closes a silent socket with 1008 when the deadline passes, not before', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS - 1)
    expect(ws.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Authentication timeout')
  })

  it('does not close a socket that authenticated before the deadline, and leaves no timer behind', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    ws.emit('message', authWith(STATIC_TOKEN))
    await vi.advanceTimersByTimeAsync(0)
    expect(sentTypes(ws)).toEqual(['auth_ok'])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_AUTH_TIMEOUT_MS * 10)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('stops the timer when the socket closes first', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    ws.emit('close')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS * 10)
    expect(ws.close).not.toHaveBeenCalled()
    expect(ws.terminate).not.toHaveBeenCalled()
  })

  it('destroys a socket that ignores the close handshake after the grace period', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    expect(ws.terminate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(limits.AGENT_WS_CLOSE_GRACE_MS)
    expect(ws.terminate).toHaveBeenCalledOnce()
  })

  it('does not destroy a socket that answered the close handshake', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    ws.emit('close')
    vi.advanceTimersByTime(limits.AGENT_WS_CLOSE_GRACE_MS * 2)
    expect(ws.terminate).not.toHaveBeenCalled()
  })

  it('ignores messages that arrive after the deadline closed the socket', async () => {
    await load()
    vi.useFakeTimers()
    const ws = await connect()
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    ws.emit('message', authWith(STATIC_TOKEN))
    ws.emit('message', authWith('wrong-token'))
    await vi.advanceTimersByTimeAsync(20)
    expect(ws.send).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
    // a rejected socket costs no token store read and no bcrypt compare
    expect(mockReadTokens).not.toHaveBeenCalled()
  })

  it('does not register an agent whose socket closed while its token was being compared', async () => {
    await load()
    const hash = await bcrypt.hash('persisted-token', 4)
    mockReadTokens.mockReturnValue([{ id: 't1', name: 'n', tokenHash: hash, createdAt: new Date().toISOString() }])
    const ws = await connect()
    ws.emit('message', authWith('persisted-token'))
    ws.emit('close') // before the bcrypt compare resolves
    await new Promise<void>((r) => setTimeout(r, 100))
    expect(mockRegister).not.toHaveBeenCalled()
    expect(limits.unauthenticatedSocketCount()).toBe(0)
  })
})

describe('cap on unauthenticated sockets', () => {
  /** n sockets that stay unauthenticated, four to a client address (the per-client cap). */
  async function fill(n: number) {
    const out: MockWs[] = []
    for (let i = 0; i < n; i++) out.push(await connect(`10.0.${Math.floor(i / 4)}.1`))
    return out
  }
  const FRESH = '10.250.0.1'

  it('refuses the socket after the cap with 1013 and does not count it', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held.forEach((w) => expect(w.close).not.toHaveBeenCalled())

    const extra = await connect(FRESH)
    expect(extra.close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, expect.any(String))
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    expect(limits.unauthenticatedKeyCount(FRESH)).toBe(0)
    // a refused socket is not served: its messages do nothing, an error event does not throw
    extra.emit('message', authWith(STATIC_TOKEN))
    expect(() => extra.emit('error', new Error('boom'))).not.toThrow()
    extra.emit('close')
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    expect(extra.send).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('frees a slot when a socket authenticates', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    await authenticate(held[0])
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    const next = await connect(FRESH)
    expect(next.close).not.toHaveBeenCalled()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
  })

  it('does not count an authenticated socket again when it closes', async () => {
    await load()
    const held = await fill(2)
    await authenticate(held[0])
    held[0].emit('close')
    held[0].emit('error', new Error('late'))
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(1)
    expect(limits.unauthenticatedKeyCount('10.0.0.1')).toBe(1)
  })

  it('frees a slot when a failed handshake closes the socket, without waiting for the close handshake', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    const bad = await connect(FRESH)
    await authenticate(bad, 'wrong')
    expect(sentTypes(bad)).toEqual(['auth_error'])
    expect(bad.close).toHaveBeenCalledWith(1008, expect.any(String))
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(held.length)
    expect(limits.unauthenticatedKeyCount(FRESH)).toBe(0)
    // the late close event does not free it again
    bad.emit('close')
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(held.length)
    expect((await connect(FRESH)).close).not.toHaveBeenCalled()
  })

  it('destroys a socket that ignores the close after a failed handshake', async () => {
    await load()
    vi.useFakeTimers()
    const bad = await connect(FRESH)
    bad.emit('message', authWith('wrong'))
    await vi.advanceTimersByTimeAsync(0)
    expect(bad.close).toHaveBeenCalledWith(1008, 'Invalid token')
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_CLOSE_GRACE_MS)
    expect(bad.terminate).toHaveBeenCalledOnce()
  })

  it('frees a slot when the client closes', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[3].emit('close')
    held[3].emit('close')
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    expect((await connect(FRESH)).close).not.toHaveBeenCalled()
    expect((await connect('10.250.0.2')).close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, expect.any(String))
  })

  it('frees a slot when the socket errors', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[0].emit('error', new Error('ECONNRESET'))
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    expect((await connect(FRESH)).close).not.toHaveBeenCalled()
  })

  it('frees a slot when the deadline closes the socket, without waiting for the close handshake', async () => {
    await load()
    vi.useFakeTimers()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    held.forEach((w) => expect(w.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Authentication timeout'))
    expect(limits.unauthenticatedSocketCount()).toBe(0)
    expect((await connect(FRESH)).close).not.toHaveBeenCalled()
    // the late close events of the timed-out sockets do not free a slot a second time
    held.forEach((w) => w.emit('close'))
    expect(limits.unauthenticatedSocketCount()).toBe(1)
  })

  it('frees a slot when a pre-auth message is too big', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[0].emit('message', Buffer.alloc(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES + 1, 0x20))
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
  })

  it('frees a slot when the IP budget refuses a handshake', async () => {
    await load()
    autoClose = true
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) {
      await authenticate(await connect('10.9.9.9'), 'wrong')
      await flush()
    }
    expect(limits.unauthenticatedSocketCount()).toBe(0)
    const refused = await connect('10.9.9.9')
    expect(limits.unauthenticatedSocketCount()).toBe(1)
    refused.emit('message', authWith('wrong'))
    expect(refused.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
    await flush()
    expect(limits.unauthenticatedSocketCount()).toBe(0)
    expect(limits.unauthenticatedKeyCount('10.9.9.9')).toBe(0)
  })
})

describe('cap per client', () => {
  const PEER = '10.1.1.1'
  const MAX = () => limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY

  /** The key is full of sockets that stay unauthenticated. */
  async function fillKey(peer = PEER) {
    const out: MockWs[] = []
    for (let i = 0; i < MAX(); i++) out.push(await connect(peer))
    return out
  }
  const refused = (w: MockWs) => w.close.mock.calls.some((c) => c[0] === limits.WS_CLOSE_TRY_AGAIN_LATER)

  it('refuses the socket after one client key holds its share, and lets other clients in', async () => {
    await load()
    const held = await fillKey()
    expect(limits.unauthenticatedKeyCount(PEER)).toBe(MAX())
    const extra = await connect(PEER)
    expect(refused(extra)).toBe(true)
    // the refused socket is not counted, globally or per key
    expect(limits.unauthenticatedKeyCount(PEER)).toBe(MAX())
    expect(limits.unauthenticatedSocketCount()).toBe(MAX())
    held.forEach((w) => expect(w.close).not.toHaveBeenCalled())
    expect(refused(await connect('10.1.1.2'))).toBe(false)
  })

  it('keeps legitimate clients out of the way of one address holding sockets', async () => {
    await load()
    // one address makes many attempts; only its share is held, the rest is refused
    for (let i = 0; i < 20; i++) await connect(PEER)
    expect(limits.unauthenticatedSocketCount()).toBe(MAX())
    for (let i = 0; i < limits.AGENT_WS_MAX_UNAUTHENTICATED - MAX(); i++) {
      expect(refused(await connect(`10.2.${i}.1`))).toBe(false)
    }
  })

  it('counts a client without a peer address as one shared key', async () => {
    await load()
    for (let i = 0; i < MAX(); i++) expect(refused(await connect(null))).toBe(false)
    expect(refused(await connect(null))).toBe(true)
    expect(limits.unauthenticatedKeyCount('unknown')).toBe(MAX())
  })

  it('counts an IPv6 client by /64 and caps the /48 around it', async () => {
    await load()
    const inSame64 = (n: number) => `2001:db8:1:1::${n + 1}`
    for (let i = 0; i < MAX(); i++) expect(refused(await connect(inSame64(i)))).toBe(false)
    expect(refused(await connect(inSame64(9)))).toBe(true)
    expect(limits.unauthenticatedKeyCount('2001:db8:1:1::/64')).toBe(MAX())
    expect(limits.unauthenticatedKeyCount('2001:db8:1::/48')).toBe(MAX())

    // other /64s of the same /48 fill the parent budget
    const parentMax = limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_PARENT
    for (let i = 0; i < parentMax - MAX(); i++) expect(refused(await connect(`2001:db8:1:${100 + i}::1`))).toBe(false)
    expect(limits.unauthenticatedKeyCount('2001:db8:1::/48')).toBe(parentMax)
    expect(refused(await connect('2001:db8:1:999::1'))).toBe(true)
    // another /48 is not affected
    expect(refused(await connect('2001:db8:2:1::1'))).toBe(false)
  })

  it('keys on the address the trusted proxy saw, not on forgeable header entries', async () => {
    await load({ TRUSTED_PROXY_HOPS: '1' })
    for (let i = 0; i < MAX(); i++) expect(refused(await connect('10.0.0.1', `198.51.100.${i}, 203.0.113.7`))).toBe(false)
    expect(refused(await connect('10.0.0.1', '198.51.100.99, 203.0.113.7'))).toBe(true)
    expect(refused(await connect('10.0.0.1', '203.0.113.8'))).toBe(false)
    expect(limits.unauthenticatedKeyCount('203.0.113.7')).toBe(MAX())
  })

  async function expectFreedAfter(trigger: (held: MockWs[]) => Promise<void> | void, peer = PEER) {
    const held = await fillKey(peer)
    await trigger(held)
    await flush()
    expect(limits.unauthenticatedKeyCount(peer)).toBe(MAX() - 1)
    expect(refused(await connect(peer))).toBe(false)
    expect(refused(await connect(peer))).toBe(true)
  }

  it('frees the client slot when a socket authenticates', async () => {
    await load()
    await expectFreedAfter((held) => authenticate(held[0]))
  })

  it('frees the client slot when the socket closes, once', async () => {
    await load()
    await expectFreedAfter((held) => {
      held[0].emit('close')
      held[0].emit('close')
    })
  })

  it('frees the client slot when the socket errors', async () => {
    await load()
    await expectFreedAfter((held) => {
      held[0].emit('error', new Error('ECONNRESET'))
    })
  })

  it('frees the client slot when the deadline closes the socket', async () => {
    await load()
    vi.useFakeTimers()
    const held = await fillKey()
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    expect(held.every((w) => w.close.mock.calls.length === 1)).toBe(true)
    expect(limits.unauthenticatedKeyCount(PEER)).toBe(0)
  })

  it('frees the client slot when a pre-auth message is too big', async () => {
    await load()
    await expectFreedAfter((held) => {
      held[0].emit('message', Buffer.alloc(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES + 1, 0x20))
    })
  })

  it('frees the client slot when the budget refuses a handshake', async () => {
    await load()
    autoClose = true
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) {
      await authenticate(await connect(PEER), 'wrong')
      await flush()
    }
    await expectFreedAfter((held) => {
      held[0].emit('message', authWith('wrong'))
    })
  })

  it('frees the client slot of the /64 and /48 of an IPv6 client on every path', async () => {
    await load()
    const peer = '2001:db8:7:7::5'
    const held = await fillKey(peer)
    await authenticate(held[0])
    held[1].emit('close')
    held[2].emit('error', new Error('x'))
    held[3].emit('message', Buffer.alloc(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES + 1, 0x20))
    await flush()
    expect(limits.unauthenticatedKeyCount('2001:db8:7:7::/64')).toBe(0)
    expect(limits.unauthenticatedKeyCount('2001:db8:7::/48')).toBe(0)
  })
})

describe('abandoned handshakes', () => {
  /** bcrypt.compare calls that wait for the test to resolve them. */
  function pendingCompares() {
    const resolvers: Array<(ok: boolean) => void> = []
    const spy = vi.spyOn(bcrypt, 'compare').mockImplementation(
      () => new Promise<boolean>((resolve) => resolvers.push(resolve)) as never,
    )
    return { spy, resolvers }
  }
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `n${i}`, tokenHash: `h${i}`, createdAt: new Date().toISOString() }))

  it('stops comparing once the socket closed, and keeps the slot until the running compare settles', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(5))
    const { spy, resolvers } = pendingCompares()
    try {
      const ws = await connect('10.3.3.3')
      ws.emit('message', authWith('wrong-token'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

      ws.emit('close')
      await flush()
      // the socket is gone, the compare is still running: the slot is still taken
      expect(limits.unauthenticatedSocketCount()).toBe(1)
      expect(limits.unauthenticatedKeyCount('10.3.3.3')).toBe(1)

      resolvers[0](false)
      await vi.waitFor(() => expect(limits.unauthenticatedSocketCount()).toBe(0))
      expect(limits.unauthenticatedKeyCount('10.3.3.3')).toBe(0)
      // none of the four remaining entries was compared
      expect(spy).toHaveBeenCalledTimes(1)
      expect(ws.send).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('stops comparing once the deadline passed', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(5))
    const { spy, resolvers } = pendingCompares()
    try {
      vi.useFakeTimers()
      const ws = await connect('10.3.3.3')
      ws.emit('message', authWith('wrong-token'))
      await vi.advanceTimersByTimeAsync(0)
      expect(spy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(limits.AGENT_WS_AUTH_TIMEOUT_MS)
      expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Authentication timeout')
      expect(limits.unauthenticatedSocketCount()).toBe(1)
      resolvers[0](false)
      await vi.advanceTimersByTimeAsync(0)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(limits.unauthenticatedSocketCount()).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not bind, stamp or register a token that matched after the socket closed', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(3))
    const { spy, resolvers } = pendingCompares()
    try {
      const ws = await connect('10.3.3.3')
      ws.emit('message', authWith('persisted-token'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      ws.emit('close')
      resolvers[0](true)
      await vi.waitFor(() => expect(limits.unauthenticatedSocketCount()).toBe(0))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(mockWriteTokens).not.toHaveBeenCalled()
      expect(mockRegister).not.toHaveBeenCalled()
      expect(mockReadTokens).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('bounds the compares running for closed sockets: refused sockets start none', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(5))
    const { spy } = pendingCompares()
    try {
      const sockets: MockWs[] = []
      for (let i = 0; i < limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY; i++) {
        const ws = await connect('10.3.3.3')
        ws.emit('message', authWith(`wrong-${i}`))
        sockets.push(ws)
      }
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY))
      sockets.forEach((w) => w.emit('close'))
      // all four are closed but still comparing, so the client cannot open more handshakes
      const again = await connect('10.3.3.3')
      again.emit('message', authWith('wrong-again'))
      await flush()
      expect(again.close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, expect.any(String))
      expect(spy).toHaveBeenCalledTimes(limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('per-IP handshake budget', () => {
  const tokenHashPromise = bcrypt.hash('persisted-token', 4)

  async function withPersistedToken() {
    const hash = await tokenHashPromise
    mockReadTokens.mockReturnValue([{ id: 't1', name: 'n', tokenHash: hash, createdAt: new Date().toISOString() }])
  }

  beforeEach(() => {
    autoClose = true
  })

  async function fail(peer: string, forwarded?: string) {
    const ws = await connect(peer, forwarded)
    await authenticate(ws, 'wrong-token')
    await flush()
    return ws
  }

  it('answers failures normally until the budget is used up, then closes before the token store is read', async () => {
    await load()
    const max = limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS
    for (let i = 0; i < max; i++) {
      const ws = await fail('10.0.0.1')
      expect(sentTypes(ws)).toEqual(['auth_error'])
    }
    expect(mockReadTokens).toHaveBeenCalledTimes(max)

    const blocked = await connect('10.0.0.1')
    blocked.emit('message', authWith('wrong-token'))
    expect(blocked.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
    // no auth_error: the reference agent stops for good on that message, and this refusal is temporary
    expect(blocked.send).not.toHaveBeenCalled()
    expect(mockReadTokens).toHaveBeenCalledTimes(max)
  })

  it('does not run bcrypt for a refused handshake', async () => {
    await load()
    await withPersistedToken()
    const compare = vi.spyOn(bcrypt, 'compare')
    try {
      for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1')
      const compared = compare.mock.calls.length
      expect(compared).toBe(limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS)
      const blocked = await connect('10.0.0.1')
      blocked.emit('message', authWith('persisted-token'))
      expect(compare.mock.calls.length).toBe(compared)
      expect(mockRegister).not.toHaveBeenCalled()
    } finally {
      compare.mockRestore()
    }
  })

  it('blocks even the right persisted token from an IP that used up its budget', async () => {
    await load()
    await withPersistedToken()
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1')
    const ws = await connect('10.0.0.1')
    ws.emit('message', authWith('persisted-token'))
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('lets another IP authenticate while one IP is blocked', async () => {
    await load()
    await withPersistedToken()
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1')

    const other = await connect('10.0.0.2')
    await authenticate(other, 'persisted-token')
    expect(sentTypes(other)).toEqual(['auth_ok'])
    expect(mockRegister).toHaveBeenCalledOnce()
  })

  it('does not count static-token handshakes, from a blocked IP too', async () => {
    await load()
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1')
    const ws = await connect('10.0.0.1')
    await authenticate(ws, STATIC_TOKEN)
    expect(sentTypes(ws)).toEqual(['auth_ok'])
    expect(ws.close).not.toHaveBeenCalled()

    // and a static token does not wipe the failures of its IP
    const again = await connect('10.0.0.1')
    again.emit('message', authWith('wrong-token'))
    expect(again.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
  })

  it('clears the failures of an IP after a successful persisted-token handshake', async () => {
    await load()
    await withPersistedToken()
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 1; i++) await fail('10.0.0.1')
    const ok = await connect('10.0.0.1')
    await authenticate(ok, 'persisted-token')
    expect(sentTypes(ok)).toEqual(['auth_ok'])
    // a full budget again
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 1; i++) {
      expect(sentTypes(await fail('10.0.0.1'))).toEqual(['auth_error'])
    }
  })

  it('charges a handshake when it is admitted, before the token store is read', async () => {
    await load()
    const ws = await connect('10.0.0.1')
    ws.emit('message', authWith('wrong-token'))
    // the store was read synchronously after the charge; a second socket of the same IP is charged too
    expect(mockReadTokens).toHaveBeenCalledTimes(1)
    const ws2 = await connect('10.0.0.1')
    ws2.emit('message', authWith('wrong-token'))
    expect(mockReadTokens).toHaveBeenCalledTimes(2)
    await flush()
    // two charges stand, so eight more fit
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 2; i++) await fail('10.0.0.1')
    const over = await connect('10.0.0.1')
    over.emit('message', authWith('wrong-token'))
    expect(over.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
  })

  it('keys on the socket peer when no proxy is trusted, whatever X-Forwarded-For says', async () => {
    await load({ TRUSTED_PROXY_HOPS: '0' })
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1', `203.0.113.${i}`)
    const ws = await connect('10.0.0.1', '203.0.113.200')
    ws.emit('message', authWith('wrong-token'))
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
  })

  it('keys on the address the trusted proxy saw when TRUSTED_PROXY_HOPS is set', async () => {
    await load({ TRUSTED_PROXY_HOPS: '1' })
    // one proxy at 10.0.0.1 in front; the client it saw is the last entry, the entries before it are forgeable
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) await fail('10.0.0.1', `198.51.100.${i}, 203.0.113.7`)

    const sameClient = await connect('10.0.0.1', '198.51.100.99, 203.0.113.7')
    sameClient.emit('message', authWith('wrong-token'))
    expect(sameClient.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')

    // another client behind the same proxy is not blocked
    const otherClient = await connect('10.0.0.1', '203.0.113.8')
    await authenticate(otherClient, 'wrong-token')
    expect(sentTypes(otherClient)).toEqual(['auth_error'])
  })
})

describe('one handshake per socket', () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `n${i}`, tokenHash: `h${i}`, createdAt: new Date().toISOString() }))

  function pendingCompares() {
    const resolvers: Array<(ok: boolean) => void> = []
    const spy = vi.spyOn(bcrypt, 'compare').mockImplementation(
      () => new Promise<boolean>((resolve) => resolvers.push(resolve)) as never,
    )
    return { spy, resolvers }
  }

  it('starts one compare loop for several auth messages at once and does not close the socket for the extras', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(1))
    const { spy, resolvers } = pendingCompares()
    try {
      const ws = await connect('10.4.4.4')
      for (let i = 0; i < 8; i++) ws.emit('message', authWith('wrong-token'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      await flush()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(mockReadTokens).toHaveBeenCalledTimes(1)
      expect(ws.close).not.toHaveBeenCalled()
      expect(ws.send).not.toHaveBeenCalled()

      resolvers[0](false)
      await vi.waitFor(() => expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token'))
      // one answer for one handshake, and the loop did not go on
      expect(sentTypes(ws)).toEqual(['auth_error'])
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('charges the IP budget once for the several messages', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(1))
    const { spy, resolvers } = pendingCompares()
    try {
      const ws = await connect('10.4.4.4')
      for (let i = 0; i < 8; i++) ws.emit('message', authWith('wrong-token'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      resolvers[0](false)
      await flush()
      for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 1; i++) {
        autoClose = true
        const w = await connect('10.4.4.4')
        w.emit('message', authWith('wrong-token'))
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(i + 2))
        resolvers[i + 1](false)
        await flush()
      }
      const over = await connect('10.4.4.4')
      over.emit('message', authWith('wrong-token'))
      expect(over.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
    } finally {
      spy.mockRestore()
    }
  })

  it('lets a handshake of another socket of the same address run at the same time', async () => {
    await load()
    mockReadTokens.mockReturnValue(entries(3))
    const { spy } = pendingCompares()
    try {
      const a = await connect('10.4.4.4')
      const b = await connect('10.4.4.4')
      a.emit('message', authWith('wrong-token'))
      b.emit('message', authWith('wrong-token'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    } finally {
      spy.mockRestore()
    }
  })

  it('counts a socket whose token was rejected as gone: later messages cost nothing', async () => {
    await load()
    const ws = await connect('10.4.4.4')
    await authenticate(ws, 'wrong-token')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(mockReadTokens).toHaveBeenCalledTimes(1)
    // no close event yet: the socket is still open for the peer, but the server is done with it
    ws.send.mockClear()
    ws.emit('message', authWith('wrong-token'))
    ws.emit('message', authWith(STATIC_TOKEN))
    await flush()
    expect(mockReadTokens).toHaveBeenCalledTimes(1)
    expect(ws.send).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('counts a socket as gone when the token store cannot be read', async () => {
    await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockReadTokens.mockImplementationOnce(() => {
        throw new Error('EIO')
      })
      const ws = await connect('10.4.4.4')
      await authenticate(ws, 'wrong-token')
      expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
      ws.send.mockClear()
      ws.emit('message', authWith(STATIC_TOKEN))
      await flush()
      expect(ws.send).not.toHaveBeenCalled()
      expect(limits.unauthenticatedSocketCount()).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('a handler that throws', () => {
  it('produces no unhandled rejection, logs only the message, and frees the slot', async () => {
    await load()
    mockRegister.mockImplementationOnce(() => {
      throw new Error('registry exploded')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejections: unknown[] = []
    const onRejection = (err: unknown) => rejections.push(err)
    process.on('unhandledRejection', onRejection)
    try {
      const ws = await connect('10.5.5.5')
      ws.emit('message', authWith(STATIC_TOKEN))
      await vi.waitFor(() => expect(limits.unauthenticatedSocketCount()).toBe(0))
      await new Promise<void>((r) => setTimeout(r, 50))
      expect(rejections).toEqual([])
      const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(logged).toContain('registry exploded')
      expect(logged).not.toContain(STATIC_TOKEN)
      expect(limits.unauthenticatedKeyCount('10.5.5.5')).toBe(0)
    } finally {
      process.off('unhandledRejection', onRejection)
      warn.mockRestore()
    }
  })

  it('treats a compare that throws as a miss and closes the socket', async () => {
    await load()
    mockReadTokens.mockImplementationOnce(() => [{ id: 't', name: 'n', tokenHash: 'h', createdAt: 'x' }])
    const compare = vi.spyOn(bcrypt, 'compare').mockImplementationOnce(() => Promise.reject(new Error('bcrypt failed')) as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ws = await connect('10.5.5.6')
      ws.emit('message', authWith('wrong-token'))
      await flush()
      await vi.waitFor(() => expect(ws.close).toHaveBeenCalled())
      expect(compare).toHaveBeenCalledTimes(1)
    } finally {
      compare.mockRestore()
      warn.mockRestore()
    }
  })
})

describe('upgradeClientKeys', () => {
  beforeEach(async () => {
    await load()
  })

  it('uses the peer address with 0 hops and ignores X-Forwarded-For', () => {
    expect(limits.upgradeClientKeys(reqFrom('10.1.2.3', '1.1.1.1'), 0)).toEqual({ key: '10.1.2.3' })
  })

  it('uses the N-th address from the right with N hops', () => {
    expect(limits.upgradeClientKeys(reqFrom('10.1.2.3', 'spoofed, 1.1.1.1, 2.2.2.2'), 2)).toEqual({ key: '1.1.1.1' })
  })

  it('falls back to the peer when the header has fewer entries than hops', () => {
    expect(limits.upgradeClientKeys(reqFrom('10.1.2.3', '1.1.1.1'), 2)).toEqual({ key: '10.1.2.3' })
  })

  it('joins repeated X-Forwarded-For header values', () => {
    const req = { socket: { remoteAddress: '10.1.2.3' }, headers: { 'x-forwarded-for': ['spoofed', '1.1.1.1'] } }
    expect(limits.upgradeClientKeys(req as unknown as IncomingMessage, 1)).toEqual({ key: '1.1.1.1' })
  })

  it('shares one key when there is no peer address and no trusted header', () => {
    expect(limits.upgradeClientKeys(reqFrom(undefined, '1.1.1.1'), 0)).toEqual({ key: 'unknown' })
  })

  it('maps an IPv6 peer to its /64 with the /48 as parent', () => {
    expect(limits.upgradeClientKeys(reqFrom('2001:db8:1:2:3:4:5:6'), 0)).toEqual({
      key: '2001:db8:1:2::/64',
      parent: '2001:db8:1::/48',
    })
  })
})

describe('against a real ws server', () => {
  let server: Server | undefined
  let wss: WebSocketServer | undefined

  afterEach(async () => {
    wss?.clients.forEach((c) => c.terminate())
    wss?.close()
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server?.closeAllConnections()
    server = undefined
    wss = undefined
  })

  async function start(): Promise<string> {
    server = createServer()
    wss = limits.createAgentWebSocketServer()
    wss.on('connection', handle)
    server.on('upgrade', (req, socket, head) => wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit('connection', ws, req)))
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents/ws`
  }

  function open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }

  const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))

  it('closes a message over the server payload limit with 1009, before and after authentication', async () => {
    await load()
    const url = await start()

    const pre = await open(url)
    const preClosed = closeCode(pre)
    pre.send(Buffer.alloc(limits.AGENT_WS_MAX_PAYLOAD_BYTES + 1, 0x20))
    expect(await preClosed).toBe(1009)

    const post = await open(url)
    const answered = new Promise<void>((resolve) => post.once('message', () => resolve()))
    post.send(authWith(STATIC_TOKEN))
    await answered
    const postClosed = closeCode(post)
    post.send(Buffer.alloc(limits.AGENT_WS_MAX_PAYLOAD_BYTES + 1, 0x20))
    expect(await postClosed).toBe(1009)
  })

  it('closes a pre-auth message over the pre-auth limit with 1009 without replying', async () => {
    await load()
    const url = await start()
    const ws = await open(url)
    const replies: string[] = []
    ws.on('message', (d) => replies.push(d.toString()))
    const closed = closeCode(ws)
    ws.send(Buffer.alloc(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES + 1, 0x20))
    expect(await closed).toBe(1009)
    expect(replies).toEqual([])
  })

  it('does not leak slots over many connections that authenticate, fail or disconnect', async () => {
    await load()
    const url = await start()
    const rounds = limits.AGENT_WS_MAX_UNAUTHENTICATED * 2
    for (let i = 0; i < rounds; i++) {
      const ws = await open(url)
      const closed = closeCode(ws)
      if (i % 3 === 0) {
        // authenticates with a static token, then disconnects
        const answered = new Promise<void>((resolve) => ws.once('message', () => resolve()))
        ws.send(authWith(STATIC_TOKEN))
        await answered
        ws.close()
      } else if (i % 3 === 1) {
        // fails: the server closes with 1008 (a handful only, the IP budget is small)
        if (i < 3 * (limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 1)) {
          ws.send(authWith('wrong-token'))
        } else {
          ws.close()
        }
      } else {
        ws.close() // disconnects without a word
      }
      await closed
    }
    await vi.waitFor(() => expect(limits.unauthenticatedSocketCount()).toBe(0))
    const last = await open(url)
    const answered = new Promise<string>((resolve) => last.once('message', (d) => resolve(d.toString())))
    last.send(authWith(STATIC_TOKEN))
    expect(JSON.parse(await answered).type).toBe('auth_ok')
  })
})
