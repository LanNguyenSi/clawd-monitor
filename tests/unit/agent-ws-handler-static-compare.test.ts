/**
 * The handshake itself must compare the presented token with every static
 * token through safeEqual, whichever entry matches.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

const compared: Array<[string, string]> = []

vi.mock('@/lib/secure-compare', async () => {
  const actual = await vi.importActual<typeof import('@/lib/secure-compare')>('@/lib/secure-compare')
  return {
    safeEqual: (a: string, b: string) => {
      compared.push([a, b])
      return actual.safeEqual(a, b)
    },
  }
})

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({
  registry: {
    agents: new Map(),
    register: vi.fn(),
    update: vi.fn(() => true),
    disconnect: vi.fn(),
    getAll: vi.fn(() => []),
    getAgent: vi.fn(() => null),
    cleanup: vi.fn(),
  },
}))

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
}

const TOKENS = ['static-one', 'static-two', 'static-three']

async function handshake(token: string): Promise<{ type: string }> {
  const mod = await import('@/lib/agent-ws-handler')
  const ws = new MockWs()
  mod.handleAgentConnection(ws as unknown as WebSocket, {} as IncomingMessage)
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token, agentId: 'agent-1', name: 'A', version: '1' })))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalled(), { timeout: 5000 })
  return JSON.parse(ws.send.mock.calls[0][0] as string)
}

describe('handshake static token comparison', () => {
  beforeAll(() => {
    vi.stubEnv('AGENT_TOKENS', TOKENS.join(','))
    vi.resetModules()
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  beforeEach(() => {
    compared.length = 0
  })

  it('accepts the first static token and still compares against all of them', async () => {
    expect((await handshake('static-one')).type).toBe('auth_ok')
    expect(compared.map(([, t]) => t)).toEqual(TOKENS)
  })

  it('accepts the last static token', async () => {
    expect((await handshake('static-three')).type).toBe('auth_ok')
    expect(compared).toHaveLength(TOKENS.length)
  })

  it('rejects an unknown token after comparing against all static tokens', async () => {
    expect((await handshake('static-nope')).type).toBe('auth_error')
    expect(compared).toHaveLength(TOKENS.length)
  })
})
