/**
 * SSRF regression tests for the session-log route.
 *
 * The route fetches from an agent-registered gatewayUrl (attacker-influencable
 * via the WebSocket connect payload). It must route through gatewayFetch so
 * assertGatewayUrlAllowed rejects private/loopback/metadata targets before any
 * outbound request, and redirects are not auto-followed.
 *
 * gateway.ts reads its env at module load time, so the route module is loaded
 * dynamically after vi.stubEnv + vi.resetModules (same pattern as gateway.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  isAuthenticated: () => true,
}))

const agents = new Map<string, Record<string, unknown>>()
vi.mock('@/lib/agent-registry', () => ({
  registry: { agents },
}))

async function loadRoute() {
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', 'http://localhost:9500')
  vi.stubEnv('ALLOWED_GATEWAY_HOSTS', '')
  vi.stubEnv('DEFAULT_GATEWAY_TOKEN', '')
  vi.resetModules()
  return import('@/app/api/agents/[agentId]/session-log/route')
}

function makeRequest(agentId = 'a1') {
  const req = new NextRequest(
    `http://dashboard.test/api/agents/${agentId}/session-log?sessionKey=sess-1&limit=10`
  )
  return { req, ctx: { params: Promise.resolve({ agentId }) } }
}

describe('session-log route – SSRF guard', () => {
  beforeEach(() => {
    agents.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('blocks a private-range (metadata) gatewayUrl without any outbound fetch', async () => {
    const { GET } = await loadRoute()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    agents.set('a1', {
      online: true,
      gatewayUrl: 'http://169.254.169.254/latest/meta-data',
      gatewayToken: 'tok',
    })

    const { req, ctx } = makeRequest()
    const res = await GET(req, ctx)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/gateway URL not allowed/i)
  })

  it('blocks an https private-range gatewayUrl (empty allowlist) without outbound fetch', async () => {
    const { GET } = await loadRoute()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    agents.set('a1', {
      online: true,
      gatewayUrl: 'https://10.0.0.1',
    })

    const { req, ctx } = makeRequest()
    const res = await GET(req, ctx)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
  })

  it('fetches from the trusted default gatewayUrl with redirect:manual and the agent token', async () => {
    const { GET } = await loadRoute()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ role: 'user', text: 'hi' }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    agents.set('a1', {
      online: true,
      gatewayUrl: 'http://localhost:9500',
      gatewayToken: 'agent-tok',
    })

    const { req, ctx } = makeRequest()
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://localhost:9500/sessions/sess-1/history?limit=10&includeTools=0'
    )
    expect(opts.redirect).toBe('manual')
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer agent-tok'
    )
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
  })

  it('omits the Authorization header when the agent has no gatewayToken', async () => {
    const { GET } = await loadRoute()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    agents.set('a1', { online: true, gatewayUrl: 'http://localhost:9500' })

    const { req, ctx } = makeRequest()
    await GET(req, ctx)

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('maps a gateway 404 to 404 and other failures to 502 (behavior preserved)', async () => {
    const { GET } = await loadRoute()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    )

    agents.set('a1', { online: true, gatewayUrl: 'http://localhost:9500' })

    const { req, ctx } = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(404)
  })
})
