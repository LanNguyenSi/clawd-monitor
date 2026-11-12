/**
 * Handler + real registry: a socket that a newer connection of the same
 * agentId replaced must not write to the registry entry. The registry is the
 * real singleton here (agent-ws-handler.test.ts mocks it).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { AgentSnapshot } from '@/lib/agent-registry'

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

const STATIC_TOKEN = 'replaced-socket-static-token'

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
}

const fakeReq = {} as IncomingMessage

function snapshotMsg(name: string) {
  const data: AgentSnapshot = {
    agentId: 'reconnecting-agent',
    name,
    timestamp: Date.now(),
    version: '1.0.0',
    sessions: [],
    cronJobs: [],
    metrics: { cpuPercent: 1, memUsedBytes: 1, memTotalBytes: 2, uptimeSeconds: 3 },
    memoryFiles: { memory: 'm' },
    containers: [],
  }
  return { type: 'snapshot' as const, data }
}

function sentTypes(ws: MockWs): string[] {
  return ws.send.mock.calls.map((c) => JSON.parse(c[0] as string).type as string)
}

describe('replaced socket against the real registry', () => {
  let handleAgentConnection: (ws: WebSocket, req: IncomingMessage) => void
  let registry: typeof import('@/lib/agent-registry').registry

  beforeAll(async () => {
    vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
    vi.resetModules()
    registry = (await import('@/lib/agent-registry')).registry
    handleAgentConnection = (await import('@/lib/agent-ws-handler')).handleAgentConnection
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    registry.agents.clear()
  })

  async function connect(): Promise<MockWs> {
    const ws = new MockWs()
    handleAgentConnection(ws as unknown as WebSocket, fakeReq)
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'auth',
          token: STATIC_TOKEN,
          agentId: 'reconnecting-agent',
          name: 'Agent',
          version: '1.0.0',
        }),
      ),
    )
    await vi.waitFor(() => expect(sentTypes(ws)).toContain('auth_ok'))
    ws.send.mockClear()
    return ws
  }

  async function sendSnapshot(ws: MockWs, name: string): Promise<void> {
    ws.emit('message', Buffer.from(JSON.stringify(snapshotMsg(name))))
    await vi.waitFor(() => expect(ws.send.mock.calls.length + ws.close.mock.calls.length).toBeGreaterThan(0))
  }

  it('drops the snapshot of the replaced socket, closes it with 4000 and sends no ack', async () => {
    const wsOld = await connect()
    const wsNew = await connect()

    await sendSnapshot(wsNew, 'fresh')
    const before = registry.agents.get('reconnecting-agent')!.lastSnapshotAt

    await sendSnapshot(wsOld, 'injected')

    const entry = registry.agents.get('reconnecting-agent')!
    expect(entry.lastSnapshot?.name).toBe('fresh')
    expect(entry.lastSnapshotAt).toBe(before)
    expect(wsOld.close).toHaveBeenCalledWith(4000, 'Replaced by a newer connection')
    expect(sentTypes(wsOld)).not.toContain('ack')
    expect(wsNew.close).not.toHaveBeenCalled()
  })

  it('does not close the replaced socket at the moment the new one registers', async () => {
    const wsOld = await connect()
    await connect()

    expect(wsOld.close).not.toHaveBeenCalled()
  })

  it('keeps the agent online after the replaced socket closes, and the current socket still updates', async () => {
    const wsOld = await connect()
    const wsNew = await connect()

    await sendSnapshot(wsOld, 'injected')
    expect(wsOld.close).toHaveBeenCalled()
    // The mock's close() emits 'close' on the next microtask: let the handler see it.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(registry.agents.get('reconnecting-agent')!.online).toBe(true)

    await sendSnapshot(wsNew, 'after-reconnect')
    expect(sentTypes(wsNew)).toContain('ack')
    const entry = registry.agents.get('reconnecting-agent')!
    expect(entry.lastSnapshot?.name).toBe('after-reconnect')
    expect(entry.online).toBe(true)
  })

  it('a replaced socket cannot revive an agent whose current socket closed', async () => {
    const wsOld = await connect()
    const wsNew = await connect()
    wsNew.emit('close')
    expect(registry.agents.get('reconnecting-agent')!.online).toBe(false)

    await sendSnapshot(wsOld, 'injected')

    const entry = registry.agents.get('reconnecting-agent')!
    expect(entry.online).toBe(false)
    expect(entry.lastSnapshot).toBeNull()
  })
})
