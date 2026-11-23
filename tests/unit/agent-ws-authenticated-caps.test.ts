/**
 * Caps after authentication: authenticated sockets in total and per client
 * key, and entries in the agent registry. Handler + real registry; a socket
 * over a cap is closed with 1013 and no auth_error (so the reference agent
 * retries), and every counter is given back exactly once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

import { readTokens } from '@/lib/data-store'

const STATIC_TOKEN = 'caps-static-token'

class MockWs extends EventEmitter {
  send = vi.fn()
  ping = vi.fn()
  close = vi.fn<(code?: number, reason?: string) => void>(() => {
    queueMicrotask(() => this.emit('close'))
  })
  terminate = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
}

const asWs = (ws: MockWs) => ws as unknown as WebSocket
const reqFrom = (peer: string) => ({ socket: { remoteAddress: peer }, headers: {} }) as unknown as IncomingMessage
const sentTypes = (ws: MockWs) => ws.send.mock.calls.map((c) => JSON.parse(c[0] as string).type as string)

type Limits = typeof import('@/lib/agent-ws-limits')
let limits: Limits
let registryMod: typeof import('@/lib/agent-registry')
let registry: typeof import('@/lib/agent-registry').registry
let handle: (ws: WebSocket, req: IncomingMessage) => void

/** Open a socket and send an auth message; resolves when the handler answered or closed it. */
async function connect(agentId: string, peer = '10.0.0.1', closeAnswered = true): Promise<MockWs> {
  const ws = new MockWs()
  // A peer that never completes the close handshake: no close event follows close().
  if (!closeAnswered) ws.close = vi.fn()
  handle(asWs(ws), reqFrom(peer))
  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'auth', token: STATIC_TOKEN, agentId, name: agentId, version: '1.0.0' })),
  )
  await vi.waitFor(() => expect(ws.send.mock.calls.length + ws.close.mock.calls.length).toBeGreaterThan(0))
  return ws
}

const refused = (ws: MockWs) =>
  ws.close.mock.calls.some((c) => c[0] === limits.WS_CLOSE_TRY_AGAIN_LATER) &&
  !sentTypes(ws).includes('auth_ok') &&
  !sentTypes(ws).includes('auth_error')

const accepted = (ws: MockWs) => sentTypes(ws).includes('auth_ok') && ws.close.mock.calls.length === 0

// Distinct peers, so the per-key cap does not apply.
const peerOf = (i: number) => `10.1.${Math.floor(i / 250)}.${(i % 250) + 1}`

beforeEach(async () => {
  vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
  vi.stubEnv('TRUSTED_PROXY_HOPS', '')
  vi.resetModules()
  limits = await import('@/lib/agent-ws-limits')
  registryMod = await import('@/lib/agent-registry')
  registry = registryMod.registry
  registry.agents.clear()
  handle = (await import('@/lib/agent-ws-handler')).handleAgentConnection
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('cap on authenticated sockets in total', () => {
  it('refuses the socket over the cap with 1013, no auth message and no registry entry; frees a slot on close', async () => {
    const open: MockWs[] = []
    for (let i = 0; i < limits.AGENT_WS_MAX_AUTHENTICATED; i++) open.push(await connect(`agent-${i}`, peerOf(i)))
    expect(open.every(accepted)).toBe(true)
    expect(limits.authenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_AUTHENTICATED)

    const over = await connect('agent-over', '10.9.9.9')
    expect(refused(over)).toBe(true)
    expect(over.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(registry.agents.has('agent-over')).toBe(false)
    expect(limits.authenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_AUTHENTICATED)

    open[0].emit('close')
    expect(limits.authenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_AUTHENTICATED - 1)
    const again = await connect('agent-over', '10.9.9.9')
    expect(accepted(again)).toBe(true)
    expect(limits.authenticatedSocketCount()).toBe(limits.AGENT_WS_MAX_AUTHENTICATED)
  }, 30_000)

  it('does not let a refused reconnect of an existing agentId replace its entry', async () => {
    const open: MockWs[] = []
    for (let i = 0; i < limits.AGENT_WS_MAX_AUTHENTICATED; i++) open.push(await connect(`agent-${i}`, peerOf(i)))
    const before = registry.agents.get('agent-5')!.ws

    const over = await connect('agent-5', '10.9.9.9')
    expect(refused(over)).toBe(true)
    expect(registry.agents.get('agent-5')!.ws).toBe(before)
  }, 30_000)
})

describe('cap on authenticated sockets per client key', () => {
  it('refuses the socket over the per-key cap, counts other keys separately, and frees on close', async () => {
    const same: MockWs[] = []
    for (let i = 0; i < limits.AGENT_WS_MAX_AUTHENTICATED_PER_KEY; i++) same.push(await connect(`k-${i}`, '10.2.0.1'))
    expect(same.every(accepted)).toBe(true)
    expect(limits.authenticatedKeyCount('10.2.0.1')).toBe(limits.AGENT_WS_MAX_AUTHENTICATED_PER_KEY)

    const over = await connect('k-over', '10.2.0.1')
    expect(refused(over)).toBe(true)
    expect(registry.agents.has('k-over')).toBe(false)

    const other = await connect('k-other', '10.2.0.2')
    expect(accepted(other)).toBe(true)

    same[3].emit('close')
    expect(limits.authenticatedKeyCount('10.2.0.1')).toBe(limits.AGENT_WS_MAX_AUTHENTICATED_PER_KEY - 1)
    const again = await connect('k-over', '10.2.0.1')
    expect(accepted(again)).toBe(true)
  })

  it('keeps the key count of one client apart from the unauthenticated count (4 per key before authentication)', async () => {
    // 16 authenticated sockets of one key exist above the pre-auth limit of 4
    // because each one authenticated before the next arrived.
    expect(limits.AGENT_WS_MAX_AUTHENTICATED_PER_KEY).toBeGreaterThan(limits.AGENT_WS_MAX_UNAUTHENTICATED_PER_KEY)
    for (let i = 0; i < 8; i++) expect(accepted(await connect(`u-${i}`, '10.3.0.1'))).toBe(true)
    expect(limits.unauthenticatedSocketCount()).toBe(0)
  })
})

describe('a handshake refused by a cap with a valid persisted token', () => {
  it('is no failed guess: it does not use up the handshake budget of the address', async () => {
    const PERSISTED = 'persisted-token-value'
    vi.mocked(readTokens).mockReturnValue([
      { id: 't1', name: 'tok', tokenHash: await bcrypt.hash(PERSISTED, 4), createdAt: new Date().toISOString() },
    ])
    for (let i = 0; i < limits.AGENT_WS_MAX_AUTHENTICATED_PER_KEY; i++) await connect(`own-${i}`, '10.7.0.1')

    // More refused handshakes than the budget of failures (10 per window).
    const attempts = limits.AGENT_WS_HANDSHAKE_MAX_ATTEMPTS + 3
    for (let i = 0; i < attempts; i++) {
      const ws = new MockWs()
      handle(asWs(ws), reqFrom('10.7.0.1'))
      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ type: 'auth', token: PERSISTED, agentId: 'persisted-agent', name: 'p', version: '1' })),
      )
      await vi.waitFor(() => expect(ws.close).toHaveBeenCalled(), { timeout: 5000 })
      expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_TRY_AGAIN_LATER, 'Server busy')
    }
    vi.mocked(readTokens).mockReturnValue([])
  }, 30_000)
})

describe('release of the counters', () => {
  it('releases once for close, error and a second close of the same socket', async () => {
    const a = await connect('rel-a', '10.4.0.1')
    const b = await connect('rel-b', '10.4.0.1')
    expect(limits.authenticatedSocketCount()).toBe(2)

    a.emit('error', new Error('boom'))
    a.emit('close')
    a.emit('close')
    expect(limits.authenticatedSocketCount()).toBe(1)
    expect(limits.authenticatedKeyCount('10.4.0.1')).toBe(1)

    b.emit('close')
    expect(limits.authenticatedSocketCount()).toBe(0)
    expect(limits.authenticatedKeyCount('10.4.0.1')).toBe(0)
  })

  it('releases once for a socket terminated by the heartbeat (terminate ends in close)', async () => {
    vi.useFakeTimers()
    const wss = limits.createAgentWebSocketServer()
    try {
      const a = await connect('term-a', '10.5.0.1')
      const b = await connect('term-b', '10.5.0.1')
      expect(limits.authenticatedSocketCount()).toBe(2)

      await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS)
      b.emit('pong')
      await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS)

      expect(a.terminate).toHaveBeenCalledTimes(1)
      expect(b.terminate).not.toHaveBeenCalled()
      // a's own close event came after the terminate; it counted once
      expect(limits.authenticatedSocketCount()).toBe(1)
      expect(limits.authenticatedKeyCount('10.5.0.1')).toBe(1)
    } finally {
      wss.close()
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('releases the slot of a replaced socket that was closed with 4000', async () => {
    vi.useFakeTimers()
    const wss = limits.createAgentWebSocketServer()
    try {
      const old = await connect('rep-a', '10.6.0.1')
      await connect('rep-a', '10.6.0.2')
      expect(limits.authenticatedSocketCount()).toBe(2)
      await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS)
      expect(old.close).toHaveBeenCalledWith(4000, 'Replaced by a newer connection')
      expect(limits.authenticatedSocketCount()).toBe(1)
      expect(limits.authenticatedKeyCount('10.6.0.1')).toBe(0)
    } finally {
      wss.close()
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})

describe('cap on registry entries', () => {
  function fill(n: number) {
    for (let i = 0; i < n; i++) {
      registry.register(new MockWs() as unknown as WebSocket, {
        agentId: `fill-${i}`,
        name: 'f',
        version: '1',
        token: 't',
      })
    }
  }

  it('refuses a new agentId at the cap with 1013 and gives the authenticated slot back', async () => {
    fill(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
    expect(registry.agents.size).toBe(registryMod.AGENT_REGISTRY_MAX_ENTRIES)

    // The slot is given back at the refusal, not only when the peer answers the close.
    const ws = await connect('brand-new', '10.0.0.1', false)
    expect(refused(ws)).toBe(true)
    expect(registry.agents.has('brand-new')).toBe(false)
    expect(registry.agents.size).toBe(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
    expect(limits.authenticatedSocketCount()).toBe(0)
    expect(limits.authenticatedKeyCount('10.0.0.1')).toBe(0)
    ws.emit('close') // the close that follows the refusal does not release a second time
    expect(limits.authenticatedSocketCount()).toBe(0)
  })

  it('never refuses an agentId that already has an entry, even at the cap', async () => {
    fill(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
    const ws = await connect('fill-7')
    expect(accepted(ws)).toBe(true)
    expect(registry.agents.get('fill-7')!.ws).toBe(ws)
    expect(registry.agents.size).toBe(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
  })

  it('makes room by evicting expired offline entries before refusing', async () => {
    fill(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
    // an offline entry that never had a snapshot is expired at once
    const old = registry.agents.get('fill-0')!
    registry.disconnect('fill-0', old.ws)

    const ws = await connect('brand-new')
    expect(accepted(ws)).toBe(true)
    expect(registry.agents.has('fill-0')).toBe(false)
    expect(registry.agents.has('brand-new')).toBe(true)
    expect(registry.agents.size).toBe(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
  })

  it('does not evict an offline entry that is still inside its TTL', async () => {
    fill(registryMod.AGENT_REGISTRY_MAX_ENTRIES)
    const entry = registry.agents.get('fill-0')!
    entry.lastSnapshotAt = Date.now()
    registry.disconnect('fill-0', entry.ws)

    const ws = await connect('brand-new')
    expect(refused(ws)).toBe(true)
    expect(registry.agents.has('fill-0')).toBe(true)
  })
})
