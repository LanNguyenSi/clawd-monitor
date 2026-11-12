/**
 * A static-token handshake for an agentId bound to a persisted token, against
 * the real AgentRegistry (no registry mock): the victim's entry keeps the
 * victim's socket and snapshot.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

import { readTokens } from '@/lib/data-store'

const mockReadTokens = vi.mocked(readTokens)

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
}

describe('static token against the real registry', () => {
  const STATIC_TOKEN = 'registry-static-token'
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void
  let registry: typeof import('@/lib/agent-registry').registry

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
    vi.resetModules()
    ;({ registry } = await import('@/lib/agent-registry'))
    ;({ handleAgentConnection } = await import('@/lib/agent-ws-handler'))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    registry.agents.clear()
    mockReadTokens.mockReturnValue([
      { id: 'tok-v', name: 'victim', tokenHash: 'h', createdAt: 'c', agentId: 'victim' },
    ])
  })

  function auth(ws: MockWs, agentId: string) {
    handleAgentConnection(ws as unknown as WebSocket, {} as IncomingMessage)
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'auth', token: STATIC_TOKEN, agentId, name: `host ${agentId}`, version: '1',
    })))
  }

  it('refuses the takeover and the victim entry still holds the victim socket and name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const victimWs = new MockWs()
    registry.register(victimWs as unknown as WebSocket, {
      agentId: 'victim', name: 'Victim', version: '1', token: 'victim-token',
    })
    const before = registry.agents.get('victim')

    const attacker = new MockWs()
    auth(attacker, 'victim')
    await vi.waitFor(() => expect(attacker.close).toHaveBeenCalled(), { timeout: 5000 })

    expect(JSON.parse(attacker.send.mock.calls[0][0] as string)).toEqual({ type: 'auth_error', message: 'Invalid token' })
    expect(attacker.close).toHaveBeenCalledWith(1008, 'Invalid token')
    const after = registry.agents.get('victim')
    expect(after).toBe(before)
    expect(after?.ws).toBe(victimWs)
    expect(after?.name).toBe('Victim')
    expect(victimWs.close).not.toHaveBeenCalled()
  })

  it('still registers a static agent with an unbound agentId', async () => {
    const ws = new MockWs()
    auth(ws, 'free-host')
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled(), { timeout: 5000 })

    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    expect(registry.agents.get('free-host')?.ws).toBe(ws)
  })
})
