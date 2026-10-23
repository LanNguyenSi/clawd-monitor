/**
 * Log streaming routes: /api/agents/:id/logs and /api/stream/logs.
 *
 * - the stream route's docker source validates the container name (400, spawn
 *   never called for an invalid one) and passes `--` before it;
 * - the agent route never starts docker (the containers would be this
 *   server's, not the agent's) and answers the not-available lines;
 * - both routes accept only the known log sources (400 otherwise);
 * - the agent route fetches the gateway URL the agent reported at its
 *   handshake only through remoteGatewayFetch (the operator's default gateway
 *   URL gets no exception there); the stream route goes through gatewayFetch.
 *   The pinned-address transport is replaced by a mock here and tested in
 *   pinned-fetch.test.ts; this file pins what the routes hand to it.
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
  pinnedFetch: vi.fn(),
  agents: new Map<string, Record<string, unknown>>(),
}))

vi.mock('child_process', () => ({ spawn: h.spawn }))
vi.mock('@/lib/pinned-fetch', () => ({ pinnedFetch: h.pinnedFetch }))
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
  // Loaded after the reset, so it is the class the routes see.
  const { GatewayUrlError } = await import('@/lib/gateway-policy')
  return { agentGET: agentRoute.GET, streamGET: streamRoute.GET, GatewayUrlError }
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
  h.pinnedFetch.mockReset()
  h.agents.clear()
  vi.stubEnv('ALLOWED_GATEWAY_HOSTS', 'gw.example.com')
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'http://localhost:9500')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const INVALID_NAMES = ['--since=1h', '-v', '--', '.hidden', 'a b', 'a;b', '../x', 'a/b']

describe('GET /api/agents/:id/logs, docker source', () => {
  const DOCKER_NOT_AVAILABLE = [
    '[info] Docker logs are not available for agents.',
    '[info] Clear the agent selection to tail containers on the clawd-monitor host.',
  ]

  it.each(['my-app_1.2', '', ...INVALID_NAMES])('never spawns docker for an agent request, container %j', async (name) => {
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq(`source=docker&container=${encodeURIComponent(name)}`), params)
    expect(res.status).toBe(200)
    expect(await readLines(res, 2)).toEqual(DOCKER_NOT_AVAILABLE)
    expect(h.spawn).not.toHaveBeenCalled()
    // Not forwarded to the agent's gateway either.
    expect(h.pinnedFetch).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gives the same answer for an agent that reported no gateway URL', async () => {
    addAgent()
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=docker&container=my-app'), params)
    expect(await readLines(res, 2)).toEqual(DOCKER_NOT_AVAILABLE)
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

describe('GET /api/agents/:id/logs, source parameter', () => {
  it.each([
    'bogus',
    'openclaw%26token%3Dx',
    'openclaw%23frag',
    'openclaw%0d%0aX-Evil%3A1',
    'openclaw%20',
    'OPENCLAW',
    '..%2F..%2Fadmin',
    '',
  ])('answers 400 for source %j and neither fetches nor spawns', async (source) => {
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq(`source=${source}`), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
    expect(h.pinnedFetch).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults to openclaw when no source is given', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com' })
    h.pinnedFetch.mockResolvedValue(new Response('line one\n'))
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq(''), params)
    expect(await readLines(res, 1)).toEqual(['line one'])
    expect(h.pinnedFetch.mock.calls[0][0]).toBe('https://gw.example.com/logs/stream?source=openclaw')
  })

  it('accepts system and answers it without a gateway fetch', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com' })
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=system'), params)
    expect(res.status).toBe(200)
    expect(await readLines(res, 1)).toEqual(['[info] System log streaming not available for remote agents.'])
    expect(h.pinnedFetch).not.toHaveBeenCalled()
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
    ['allowlisted name on a port that is not allowed', 'https://gw.example.com:8443'],
  ])('does not fetch %s and answers the not-available lines', async (_label, gatewayUrl) => {
    addAgent({ gatewayUrl, gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(res.status).toBe(200)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.pinnedFetch).not.toHaveBeenCalled()
  })

  it('shows the not-available lines when the gateway host resolves to a private address', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    const { agentGET, GatewayUrlError } = await loadRoutes()
    h.pinnedFetch.mockRejectedValue(new GatewayUrlError('Gateway host not allowed'))
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(h.pinnedFetch).toHaveBeenCalledTimes(1)
  })

  it('fetches an allowlisted https gateway with the agent token through the pinned transport only', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com/', gatewayToken: 'secret-token' })
    h.pinnedFetch.mockResolvedValue(new Response('line one\nline two\n'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(['line one', 'line two'])
    expect(h.pinnedFetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.pinnedFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example.com/logs/stream?source=openclaw')
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts an allowlisted host on the port its allowlist entry names', async () => {
    vi.stubEnv('ALLOWED_GATEWAY_HOSTS', 'gw.example.com,ported.example.com:8443')
    addAgent({ gatewayUrl: 'https://ported.example.com:8443' })
    h.pinnedFetch.mockResolvedValue(new Response('line one\n'))
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 1)).toEqual(['line one'])
    expect(h.pinnedFetch.mock.calls[0][0]).toBe('https://ported.example.com:8443/logs/stream?source=openclaw')
  })

  it('shows a redirect answer as unavailable and requests nothing else', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com' })
    h.pinnedFetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }))
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(h.pinnedFetch).toHaveBeenCalledTimes(1)
  })

  it('gives the operator default gateway URL no exception when an agent reports it', async () => {
    addAgent({ gatewayUrl: 'http://localhost:9500', gatewayToken: 'secret-token' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 2)).toEqual(NOT_AVAILABLE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.pinnedFetch).not.toHaveBeenCalled()
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
    expect(h.pinnedFetch).not.toHaveBeenCalled()
  })

  it('still fetches an allowlisted https host when the default gateway URL is that same host', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'https://gw.example.com')
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    h.pinnedFetch.mockResolvedValue(new Response('line one\n'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    expect(await readLines(res, 1)).toEqual(['line one'])
    expect(h.pinnedFetch).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
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

describe('GET /api/stream/logs, source parameter', () => {
  const streamReq = (query: string) => new NextRequest(`http://localhost/api/stream/logs?${query}`)

  it.each(['bogus', 'openclaw%26x%3D1', 'DOCKER', '..%2Fx', ''])('answers 400 for source %j and neither spawns nor fetches', async (source) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq(`source=${source}`))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
    expect(h.spawn).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.pinnedFetch).not.toHaveBeenCalled()
  })

  it('treats a missing source as openclaw', async () => {
    const fetchMock = vi.fn(async () => new Response('line one\n'))
    vi.stubGlobal('fetch', fetchMock)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(streamReq(''))
    expect(await readLines(res, 1)).toEqual(['line one'])
  })
})

describe('GET /api/stream/logs, caller-chosen gateway URL', () => {
  const gwReq = (url: string) => new NextRequest('http://localhost/api/stream/logs?source=openclaw', {
    headers: { 'x-gateway-url': url, 'x-gateway-token': 'caller-token' },
  })

  it('fetches an allowlisted https URL through the pinned transport, not the global fetch', async () => {
    h.pinnedFetch.mockResolvedValue(new Response('line one\n'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(gwReq('https://gw.example.com'))
    expect(await readLines(res, 1)).toEqual(['line one'])
    const [url, init] = h.pinnedFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://gw.example.com/logs/stream')
    expect(init.headers.Authorization).toBe('Bearer caller-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a host outside the allowlist', 'https://evil.example.net', 'Gateway host not allowed'],
    ['a port the allowlist does not name', 'https://gw.example.com:8443', 'Gateway port not allowed'],
    ['plain http', 'http://gw.example.com', 'Gateway URL must use https'],
  ])('rejects %s with an error line and the local journal', async (_label, url, message) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(gwReq(url))
    expect(await readLines(res, 1)).toEqual([`[error] ${message}`])
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn.mock.calls[0][0]).toBe('journalctl')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.pinnedFetch).not.toHaveBeenCalled()
  })

  it('answers an error line and the local journal when the host resolves to a private address', async () => {
    const { streamGET, GatewayUrlError } = await loadRoutes()
    h.pinnedFetch.mockRejectedValue(new GatewayUrlError('Gateway host not allowed'))
    const res = await streamGET(gwReq('https://gw.example.com'))
    expect(await readLines(res, 1)).toEqual(['[error] Gateway host not allowed'])
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn.mock.calls[0][0]).toBe('journalctl')
  })

  it('keeps the connecting hint for a failure that is not a URL rejection', async () => {
    h.pinnedFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const { streamGET } = await loadRoutes()
    const res = await streamGET(gwReq('https://gw.example.com'))
    expect(await readLines(res, 1)).toEqual(['[info] Connecting to OpenClaw Gateway...'])
    expect(h.spawn).not.toHaveBeenCalled()
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

// A gateway answer whose body is never read keeps its connection open until
// the response is collected, so a log route that does not stream a non-OK
// answer cancels its body.
describe('log routes, non-OK gateway answers', () => {
  function errorAnswer() {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('not found'))
        c.close()
      },
      cancel,
    })
    return { res: new Response(body, { status: 404 }), cancel }
  }

  it('the agent route cancels the body and answers the not-available lines', async () => {
    addAgent({ gatewayUrl: 'https://gw.example.com', gatewayToken: 'secret-token' })
    const answer = errorAnswer()
    h.pinnedFetch.mockResolvedValue(answer.res)
    const { agentGET } = await loadRoutes()
    const res = await agentGET(agentReq('source=openclaw'), params)
    const lines = await readLines(res, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[info] Log streaming not available for remote agents.')
    expect(answer.cancel).toHaveBeenCalledTimes(1)
  })

  it('the stream route cancels the body of a caller-chosen gateway and falls back to the journal', async () => {
    const answer = errorAnswer()
    h.pinnedFetch.mockResolvedValue(answer.res)
    const { streamGET } = await loadRoutes()
    const res = await streamGET(new NextRequest('http://localhost/api/stream/logs?source=openclaw', {
      headers: { 'x-gateway-url': 'https://gw.example.com' },
    }))
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1))
    expect(h.spawn.mock.calls[0][0]).toBe('journalctl')
    expect(answer.cancel).toHaveBeenCalledTimes(1)
    await res.body!.cancel()
  })

  it('the stream route cancels the body of the default gateway as well', async () => {
    const answer = errorAnswer()
    vi.stubGlobal('fetch', vi.fn(async () => answer.res))
    const { streamGET } = await loadRoutes()
    const res = await streamGET(new NextRequest('http://localhost/api/stream/logs?source=openclaw'))
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1))
    expect(answer.cancel).toHaveBeenCalledTimes(1)
    await res.body!.cancel()
  })
})
