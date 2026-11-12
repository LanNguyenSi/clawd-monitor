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
    update: vi.fn(),
    disconnect: vi.fn(),
  },
}))

import { readTokens } from '@/lib/data-store'
import { registry } from '@/lib/agent-registry'

const mockReadTokens = vi.mocked(readTokens)
const mockRegister = vi.mocked(registry.register)

type Handler = (ws: WebSocket, req: IncomingMessage) => void
type Limits = typeof import('@/lib/agent-ws-limits')

const STATIC_TOKEN = 'static-env-token'

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn()
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
async function connect(peer = '10.0.0.1', forwarded?: string): Promise<MockWs> {
  const ws = new MockWs()
  handle(asWs(ws), reqFrom(peer, forwarded))
  return ws
}

async function authenticate(ws: MockWs, token = STATIC_TOKEN) {
  ws.emit('message', authWith(token))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalled(), { timeout: 5000 })
}

const sentTypes = (ws: MockWs) => ws.send.mock.calls.map((c) => JSON.parse(c[0] as string).type)

beforeEach(() => {
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
  /** n sockets that stay unauthenticated. */
  async function fill(n: number, peer = '10.0.0.1') {
    const out: MockWs[] = []
    for (let i = 0; i < n; i++) out.push(await connect(peer))
    return out
  }

  it('refuses the socket after the cap with 1013 and does not count it', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held.forEach((w) => expect(w.close).not.toHaveBeenCalled())

    const extra = await connect()
    expect(extra.close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, expect.any(String))
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    // a refused socket is not served: its messages do nothing, an error event does not throw
    extra.emit('message', authWith(STATIC_TOKEN))
    expect(() => extra.emit('error', new Error('boom'))).not.toThrow()
    extra.emit('close')
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    expect(extra.send).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('frees a slot when a socket authenticates', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    await authenticate(held[0])
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    const next = await connect()
    expect(next.close).not.toHaveBeenCalled()
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
  })

  it('does not count an authenticated socket again when it closes', async () => {
    await load()
    const held = await fill(2)
    await authenticate(held[0])
    held[0].emit('close')
    held[0].emit('error', new Error('late'))
    expect(limits.unauthenticatedSocketCount()).toBe(1)
  })

  it('frees a slot when a failed handshake ends in a close', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    const bad = await connect()
    await authenticate(bad, 'wrong')
    expect(sentTypes(bad)).toEqual(['auth_error'])
    expect(bad.close).toHaveBeenCalledWith(1008, expect.any(String))
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    bad.emit('close')
    expect(limits.unauthenticatedSocketCount()).toBe(held.length)
    expect((await connect()).close).not.toHaveBeenCalled()
  })

  it('frees a slot when the client closes', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[3].emit('close')
    held[3].emit('close')
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    expect((await connect()).close).not.toHaveBeenCalled()
    expect((await connect()).close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, expect.any(String))
  })

  it('frees a slot when the socket errors', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[0].emit('error', new Error('ECONNRESET'))
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
    expect((await connect()).close).not.toHaveBeenCalled()
  })

  it('frees a slot when the deadline closes the socket, without waiting for the close handshake', async () => {
    await load()
    vi.useFakeTimers()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    vi.advanceTimersByTime(limits.AGENT_WS_AUTH_TIMEOUT_MS)
    held.forEach((w) => expect(w.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Authentication timeout'))
    expect(limits.unauthenticatedSocketCount()).toBe(0)
    expect((await connect()).close).not.toHaveBeenCalled()
    // the late close events of the timed-out sockets do not free a slot a second time
    held.forEach((w) => w.emit('close'))
    expect(limits.unauthenticatedSocketCount()).toBe(1)
  })

  it('frees a slot when a pre-auth message is too big', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED)
    held[0].emit('message', Buffer.alloc(limits.AGENT_WS_PREAUTH_MAX_MESSAGE_BYTES + 1, 0x20))
    expect(limits.unauthenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_UNAUTHENTICATED - 1)
  })

  it('frees a slot when the IP budget refuses a handshake', async () => {
    await load()
    const held = await fill(limits.AGENT_WS_MAX_UNAUTHENTICATED, '10.9.9.9')
    // 10.9.9.9 is used up by failures
    for (let i = 0; i < limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) held[i].emit('message', authWith('wrong'))
    await vi.waitFor(() => expect(mockReadTokens).toHaveBeenCalledTimes(limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS))
    await vi.waitFor(() => expect(held[limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS - 1].send).toHaveBeenCalled())
    const before = limits.unauthenticatedSocketCount()
    held[limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS].emit('message', authWith('wrong'))
    expect(held[limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS].close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
    expect(limits.unauthenticatedSocketCount()).toBe(before - 1)
  })
})

describe('per-IP handshake budget', () => {
  const tokenHashPromise = bcrypt.hash('persisted-token', 4)

  async function withPersistedToken() {
    const hash = await tokenHashPromise
    mockReadTokens.mockReturnValue([{ id: 't1', name: 'n', tokenHash: hash, createdAt: new Date().toISOString() }])
  }

  async function fail(peer: string, forwarded?: string) {
    const ws = await connect(peer, forwarded)
    await authenticate(ws, 'wrong-token')
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

  it('counts a handshake when it is admitted, so parallel messages on one socket cannot all pass', async () => {
    await load()
    const ws = await connect('10.0.0.1')
    for (let i = 0; i < 4 * limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS; i++) ws.emit('message', authWith('wrong-token'))
    await new Promise<void>((r) => setTimeout(r, 50))
    expect(mockReadTokens).toHaveBeenCalledTimes(limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS)
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Too many attempts')
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
