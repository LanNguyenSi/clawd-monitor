/**
 * Heartbeat of the authenticated agent sockets: handler + real registry + the
 * real server factory, with fake timers. A socket whose peer stopped answering
 * pings is terminated (the ordinary close path then marks the agent offline,
 * and the TTL removes the entry); an answering socket survives; a replaced
 * socket is closed with 4000 on a tick; the interval ends with the server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type WebSocket from 'ws'
import type { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import type { AgentSnapshot } from '@/lib/agent-registry'

vi.mock('@/lib/data-store', () => ({
  readTokens: vi.fn(() => []),
  writeTokens: vi.fn(),
}))

const STATIC_TOKEN = 'heartbeat-static-token'
const TTL_MS = 300_000

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

function snapshotMsg(agentId: string) {
  const data: AgentSnapshot = {
    agentId,
    name: 'Agent',
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

type Limits = typeof import('@/lib/agent-ws-limits')
let limits: Limits
let registry: typeof import('@/lib/agent-registry').registry
let handle: (ws: WebSocket, req: IncomingMessage) => void
let wss: WebSocketServer

async function connect(agentId = 'hb-agent', peer = '10.0.0.1'): Promise<MockWs> {
  const ws = new MockWs()
  handle(asWs(ws), reqFrom(peer))
  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'auth', token: STATIC_TOKEN, agentId, name: 'Agent', version: '1.0.0' })),
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(sentTypes(ws)).toContain('auth_ok')
  return ws
}

async function snapshot(ws: MockWs, agentId: string) {
  ws.emit('message', Buffer.from(JSON.stringify(snapshotMsg(agentId))))
  await vi.advanceTimersByTimeAsync(0)
}

const tick = (times = 1) => vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS * times)

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubEnv('AGENT_TOKENS', STATIC_TOKEN)
  vi.stubEnv('AGENT_TTL_MS', String(TTL_MS))
  vi.stubEnv('TRUSTED_PROXY_HOPS', '')
  vi.resetModules()
  limits = await import('@/lib/agent-ws-limits')
  registry = (await import('@/lib/agent-registry')).registry
  registry.agents.clear()
  handle = (await import('@/lib/agent-ws-handler')).handleAgentConnection
  wss = limits.createAgentWebSocketServer()
})

afterEach(async () => {
  wss.close()
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('heartbeat of authenticated sockets', () => {
  it('pings an authenticated socket every interval and not before', async () => {
    const ws = await connect()
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS - 1)
    expect(ws.ping).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ws.ping).toHaveBeenCalledTimes(1)
  })

  it('terminates a socket that did not answer the previous ping; the agent goes offline and the TTL removes it', async () => {
    const ws = await connect()
    await snapshot(ws, 'hb-agent')
    expect(registry.getAgent('hb-agent')?.online).toBe(true)

    await tick() // ping sent, no pong
    expect(ws.ping).toHaveBeenCalledTimes(1)
    expect(ws.terminate).not.toHaveBeenCalled()
    expect(registry.getAgent('hb-agent')?.online).toBe(true)

    await tick() // the previous ping is still unanswered
    expect(ws.terminate).toHaveBeenCalledTimes(1)
    expect(registry.getAgent('hb-agent')?.online).toBe(false)
    expect(registry.getAll().map((a) => a.agentId)).toContain('hb-agent')

    await vi.advanceTimersByTimeAsync(TTL_MS + 1)
    expect(registry.getAll().map((a) => a.agentId)).not.toContain('hb-agent')
  })

  it('keeps a socket that answers every ping, over several intervals', async () => {
    const ws = await connect()
    await snapshot(ws, 'hb-agent')
    for (let i = 0; i < 5; i++) {
      await tick()
      ws.emit('pong')
    }
    expect(ws.ping).toHaveBeenCalledTimes(5)
    expect(ws.terminate).not.toHaveBeenCalled()
    expect(registry.getAgent('hb-agent')?.online).toBe(true)
  })

  it('terminates only after a miss: a late pong before the next tick saves the socket', async () => {
    const ws = await connect()
    await tick()
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS - 1)
    ws.emit('pong')
    await vi.advanceTimersByTimeAsync(1)
    expect(ws.terminate).not.toHaveBeenCalled()
    expect(ws.ping).toHaveBeenCalledTimes(2)
  })

  it('does not ping a socket that has not authenticated, and leaves its auth deadline alone', async () => {
    const ws = new MockWs()
    handle(asWs(ws), reqFrom('10.0.0.2'))
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_AUTH_TIMEOUT_MS - 1)
    expect(ws.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ws.close).toHaveBeenCalledWith(limits.WS_CLOSE_POLICY, 'Authentication timeout')
    await tick(3)
    expect(ws.ping).not.toHaveBeenCalled()
    expect(ws.terminate).not.toHaveBeenCalled()
  })

  it('stops pinging a socket once it closed', async () => {
    const ws = await connect()
    ws.emit('close')
    await tick(3)
    expect(ws.ping).not.toHaveBeenCalled()
    expect(ws.terminate).not.toHaveBeenCalled()
  })

  it('survives a socket whose ping throws: the next tick terminates it', async () => {
    const ws = await connect()
    ws.ping.mockImplementation(() => {
      throw new Error('not open')
    })
    await tick()
    await tick()
    expect(ws.terminate).toHaveBeenCalledTimes(1)
  })

  it('ends the interval when the server closes', async () => {
    const before = vi.getTimerCount()
    expect(before).toBeGreaterThan(0)
    wss.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('replaced sockets on a tick', () => {
  it('closes a silent replaced socket with 4000 on the next tick, not before, and leaves the current one open', async () => {
    const wsOld = await connect()
    const wsNew = await connect()
    await vi.advanceTimersByTimeAsync(limits.AGENT_WS_PING_INTERVAL_MS - 1)
    // register() itself never touches the old socket
    expect(wsOld.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(wsOld.close).toHaveBeenCalledTimes(1)
    expect(wsOld.close).toHaveBeenCalledWith(4000, 'Replaced by a newer connection')
    expect(wsNew.close).not.toHaveBeenCalled()
    expect(wsNew.ping).toHaveBeenCalledTimes(1)
    // the replaced socket is not pinged and the agent stays online through its close
    expect(wsOld.ping).not.toHaveBeenCalled()
    expect(registry.getAgent('hb-agent')?.online).toBe(true)
  })

  it('closes a replaced socket only once even if its peer never completes the close', async () => {
    const wsOld = await connect()
    wsOld.close.mockImplementation(() => {})
    await connect()
    await tick(4)
    expect(wsOld.close).toHaveBeenCalledTimes(1)
    expect(wsOld.terminate).not.toHaveBeenCalled()
  })
})

describe('several servers in one process', () => {
  it('run one heartbeat: a socket that answers every ping survives, and the timer outlives all but the last server', async () => {
    const second = limits.createAgentWebSocketServer()
    try {
      const ws = await connect('multi-agent')
      for (let i = 0; i < 3; i++) {
        await tick()
        expect(ws.terminate).not.toHaveBeenCalled()
        ws.emit('pong')
      }
      expect(ws.ping).toHaveBeenCalledTimes(3)

      // Closing one server leaves the shared timer running for the other.
      second.close()
      await vi.advanceTimersByTimeAsync(0)
      await tick()
      expect(ws.ping).toHaveBeenCalledTimes(4)
      expect(ws.terminate).not.toHaveBeenCalled()
      ws.emit('pong')

      // Closing the last one stops it.
      wss.close()
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      second.close()
    }
  })

  it('a server opened after the others closed starts the heartbeat again', async () => {
    wss.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    wss = limits.createAgentWebSocketServer()
    const ws = await connect('restart-agent')
    await tick()
    expect(ws.ping).toHaveBeenCalledTimes(1)
  })
})
