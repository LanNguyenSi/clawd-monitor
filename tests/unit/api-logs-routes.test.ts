/**
 * Log streaming routes: /api/agents/:id/logs and /api/stream/logs.
 *
 * - the docker source validates the container name (400, spawn never called
 *   for an invalid one) and passes `--` before it;
 * - the agent route checks the gateway URL the agent reported at its
 *   handshake with assertGatewayUrlAllowed before fetching (the operator's
 *   default gateway URL gets no exception there), and passes redirect:
 *   'manual' to fetch.
 *
 * ALLOWED_GATEWAY_HOSTS and the default gateway URL are read when
 * src/lib/gateway.ts loads, so the routes are imported fresh after the env is
 * set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  agents: new Map<string, Record<string, unknown>>(),
}))

vi.mock('child_process', () => ({ spawn: h.spawn }))
vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn(() => true) }))
vi.mock('@/lib/agent-registry', () => ({ registry: { agents: h.agents } }))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

async function loadRoutes() {
  vi.resetModules()
  const agentRoute = await import('@/app/api/agents/[agentId]/logs/route')
  const streamRoute = await import('@/app/api/stream/logs/route')
  return { agentGET: agentRoute.GET, streamGET: streamRoute.GET }
}

/** Read `count` SSE data lines from the response, then cancel the stream. */
async function readLines(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const lines: string[] = []
  let buffer = ''
  while (lines.length < count) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    for (const frame of buffer.split('\n\n').slice(0, -1)) {
      if (frame.startsWith('data: ')) lines.push(JSON.parse(frame.slice(6)))
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2)
  }
  await reader.cancel()
  return lines
}

function addAgent(extra: Record<string, unknown> = {}) {
  h.agents.set('a1', { agentId: 'a1', online: true, ...extra })
}

const agentReq = (query: string) => new NextRequest(`http://localhost/api/agents/a1/logs?${query}`)
const params = { params: Promise.resolve({ agentId: 'a1' }) }

beforeEach(() => {
  h.spawn.mockReset()
  h.spawn.mockImplementation(() => new FakeChild())
  h.agents.clear()
  vi.stubEnv('ALLOWED_GATEWAY_HOSTS', 'gw.example.com')
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'http://localhost:9500')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const INVALID_NAMES = ['--since=1h', '-v', '--', '.hidden', 'a b', 'a;b', '../x', 'a/b']

describe('GET /api/agents/:id/logs, docker source', () => {
  it.each(INVALID_NAMES)('answers 400 and never spawns for container %j', async (name) => {
    addAgent()
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq(`source=docker&container=${encodeURIComponent(name)}`), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid container name' })
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('spawns docker logs with -- before a valid name', async () => {
    addAgent()
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=docker&container=my-app_1.2'), params)
    expect(res.status).toBe(200)
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn.mock.calls[0][0]).toBe('docker')
    expect(h.spawn.mock.calls[0][1]).toEqual(['logs', '--tail', '50', '--follow', '--', 'my-app_1.2'])
    await res.body!.cancel()
  })

  it('keeps the "no container selected" answer for an empty name and does not spawn', async () => {
    addAgent()
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=docker&container='), params)
    expect(res.status).toBe(200)
    expect(await readLines(res, 1)).toEqual(['[error] no container selected'])
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('does not validate the container parameter for other sources', async () => {
    addAgent({ gatewayUrl: undefined })
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw&container=--since%3D1h'), params)
    expect(res.status).toBe(200)
    await res.body!.cancel()
  })
})

describe('GET /api/agents/:id/logs, gateway URL guard', () => {
  const NOT_AVAILABLE = [
    '[info] Log streaming not available for remote agents.',
    '[info] The agent runs on a different host — logs cannot be proxied via this server.',
  ]

  it.each([
    ['loopback http (documented agent default)', 'http://localhost:18789'],
    ['cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['private https range', 'https://10.0.0.5'],
    ['https host outside the allowlist', 'https://evil.example.net'],
    ['non-https allowlisted host', 'http://gw.example.com'],
    ['allowlisted name but loopback address', 'https://127.0.0.1'],
    ['unparseable', 'not a url'],
    ['non-http scheme', 'file:///etc/passwd'],
  ])('does not fetch %s and answers the not-available lines', async (_label, gatewayUrl) => {
    addAgent({ gatewayUrl, gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(res.status).toBe(200)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches an allowlisted https gateway with the agent token, without following redirects', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com/', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn(async () => new Response('line one\nline two\n'))
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(['line one', 'line two'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example.com/logs/stream?source=openclaw')
    expect(init.redirect).toBe('manual')
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' })
  })

  it('requests the allowed host with redirect manual and shows a redirect answer as unavailable', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com' })
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // fetch is a mock here, so "not followed" is only visible as the option
    // handed to it: the real redirect handling belongs to fetch.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.redirect).toBe('manual')
  })

  it('gives the operator default gateway URL no exception when an agent reports it', async () => {
    addAgent({ gatewayUrl: 'http://localhost:9500', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gives a customised default gateway URL no exception either', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'http://gateway.internal:9600')
    addAgent({ gatewayUrl: 'http://gateway.internal:9600', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still fetches an allowlisted https host when the default gateway URL is that same host', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'https://gw.example.com')
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn(async () => new Response('line one\n'))
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 1)).toEqual(['line one'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers the not-available lines without fetching when the agent reported no gateway URL', async () => {
    addAgent()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/stream/logs, default gateway URL', () => {
  it('still trusts the operator default gateway URL (no https or allowlist needed)', async () => {
    const fetchMock = vi.fn(async () => new Response('line one\n'))
    vi.stubGlobal('fetch', fetchMock)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(new NextRequest('http://localhost/api/stream/logs?source=openclaw'))
    expect(await readLines(res, 1)).toEqual(['line one'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:9500/logs/stream')
  })
})

describe('GET /api/stream/logs, docker source', () => {
  const streamReq = (query: string) => new NextRequest(`http://localhost/api/stream/logs?${query}`)

  it.each(INVALID_NAMES)('answers 400 and never spawns for container %j', async (name) => {
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq(`source=docker&container=${encodeURIComponent(name)}`))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid container name' })
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('spawns docker logs with -- before a valid name', async () => {
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq('source=docker&container=my-app_1.2'))
    expect(res.status).toBe(200)
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn.mock.calls[0][0]).toBe('docker')
    expect(h.spawn.mock.calls[0][1]).toEqual(['logs', '--tail', '50', '--follow', '--', 'my-app_1.2'])
    await res.body!.cancel()
  })

  it('keeps the "no container selected" answer for an empty name and does not spawn', async () => {
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq('source=docker'))
    expect(res.status).toBe(200)
    expect(await readLines(res, 1)).toEqual(['[error] no container selected'])
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('does not validate the container parameter for other sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq('source=system&container=--since%3D1h'))
    expect(res.status).toBe(200)
    await res.body!.cancel()
  })
})
