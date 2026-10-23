/**
 * The proxy routes that forward to a gateway pass the `x-gateway-url` header of
 * the signed-in user's own browser. That URL is operator-sourced: when it equals
 * the operator default gateway it is fetched (the default may be http or
 * loopback), and any other URL still has to pass the allowlist rule. A route
 * that labelled the header "remote" would reject the default and break every
 * widget, so each route is exercised end to end here, with a stubbed global
 * fetch (the default gateway goes through it) and no network.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn(() => true) }))

const DEFAULT_URL = 'http://localhost:9500'

type Handler = (req: NextRequest, ctx?: never) => Promise<Response>
let routes: Array<{ name: string; call: (headers: Record<string, string>) => Promise<Response>; path: string }>

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', DEFAULT_URL)
  vi.stubEnv('ALLOWED_GATEWAY_HOSTS', '')
  vi.stubEnv('DEFAULT_GATEWAY_TOKEN', '')
  vi.resetModules()
  const [heartbeat, sessions, cron, memory, catchAll] = await Promise.all([
    import('@/app/api/proxy/heartbeat/route'),
    import('@/app/api/proxy/sessions/route'),
    import('@/app/api/proxy/cron/route'),
    import('@/app/api/proxy/memory/route'),
    import('@/app/api/proxy/[...path]/route'),
  ])
  const request = (url: string, headers: Record<string, string>) => new NextRequest(url, { headers })
  routes = [
    { name: 'heartbeat', path: '/status', call: (h) => (heartbeat.GET as Handler)(request('http://localhost/api/proxy/heartbeat', h)) },
    { name: 'sessions', path: '/sessions', call: (h) => (sessions.GET as Handler)(request('http://localhost/api/proxy/sessions', h)) },
    { name: 'cron', path: '/cron/jobs', call: (h) => (cron.GET as Handler)(request('http://localhost/api/proxy/cron', h)) },
    { name: 'memory', path: '/workspace/memory?file=memory', call: (h) => (memory.GET as Handler)(request('http://localhost/api/proxy/memory', h)) },
    {
      name: 'catch-all',
      path: '/anything',
      call: (h) => catchAll.GET(request('http://localhost/api/proxy/anything', h), { params: Promise.resolve({ path: ['anything'] }) }),
    },
  ]
})

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('gateway proxy routes, x-gateway-url from the signed-in browser', () => {
  it.each(['heartbeat', 'sessions', 'cron', 'memory', 'catch-all'])(
    '%s fetches the operator default gateway when the header equals it',
    async (name) => {
      const route = routes.find((r) => r.name === name)!
      await route.call({ 'x-gateway-url': DEFAULT_URL })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_URL}${route.path}`)
    },
  )

  it.each(['heartbeat', 'sessions', 'cron', 'memory', 'catch-all'])(
    '%s fetches the operator default gateway when there is no header',
    async (name) => {
      const route = routes.find((r) => r.name === name)!
      await route.call({})
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_URL}${route.path}`)
    },
  )

  it.each(['heartbeat', 'sessions', 'cron', 'memory', 'catch-all'])(
    '%s fetches nothing for a header URL that is not allowlisted',
    async (name) => {
      const route = routes.find((r) => r.name === name)!
      await route.call({ 'x-gateway-url': 'http://evil.example.com' })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

// A gateway answer whose body is never read keeps its connection open until
// the response is collected, so every route either reads the body or cancels it.
describe('gateway proxy routes, non-OK answers', () => {
  /** A 500 answer with a streamed body, and whether it was cancelled. */
  function errorAnswer() {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"error":"down"}'))
        c.close()
      },
      cancel,
    })
    return { res: new Response(body, { status: 500, headers: { 'content-type': 'application/json' } }), cancel }
  }

  it.each(['heartbeat', 'sessions', 'cron', 'memory', 'catch-all'])(
    '%s reads or cancels the body of a non-OK gateway answer',
    async (name) => {
      const answer = errorAnswer()
      fetchMock.mockImplementation(async () => answer.res)
      const route = routes.find((r) => r.name === name)!
      await route.call({})
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(answer.res.bodyUsed).toBe(true)
    },
  )

  it.each(['heartbeat', 'sessions', 'memory'])('%s cancels the body it does not read', async (name) => {
    const answer = errorAnswer()
    fetchMock.mockImplementation(async () => answer.res)
    await routes.find((r) => r.name === name)!.call({})
    expect(answer.cancel).toHaveBeenCalledTimes(1)
  })
})
