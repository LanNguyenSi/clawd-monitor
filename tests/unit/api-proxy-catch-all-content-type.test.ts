/**
 * The catch-all proxy route runs on the dashboard origin. Whatever the gateway
 * answers with, the response must never carry an upstream-chosen content type:
 * a served HTML, SVG or JavaScript document would execute on this origin.
 * JSON answers stay JSON (the dashboard parses JSON), everything else is
 * served as inert text with an attachment disposition, and every answer of
 * the route carries nosniff itself. The gateway is a stubbed global fetch,
 * like in api-proxy-gateway-routes.test.ts, and no test touches the network.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn(() => true) }))

const DEFAULT_URL = 'http://localhost:9500'
const BODY = '<html><script>alert(1)</script></html>'

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) => Promise<Response>
let GET: Handler

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', DEFAULT_URL)
  vi.stubEnv('ALLOWED_GATEWAY_HOSTS', '')
  vi.stubEnv('DEFAULT_GATEWAY_TOKEN', '')
  vi.resetModules()
  const mod = await import('@/app/api/proxy/[...path]/route')
  GET = mod.GET as Handler
})

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

const fetchMock = vi.fn()
beforeEach(() => {
  vi.mocked(isAuthenticated).mockReturnValue(true)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

/** Stub the gateway with an answer of this status, type (null: no header) and body. */
function upstream(status: number, contentType: string | null, body: string) {
  const headers: Record<string, string> = {}
  if (contentType !== null) headers['content-type'] = contentType
  fetchMock.mockImplementation(async () => new Response(body, { status, headers }))
}

function call(headers: Record<string, string> = {}) {
  const req = new NextRequest('http://localhost/api/proxy/anything', { headers })
  return GET(req, { params: Promise.resolve({ path: ['anything'] }) })
}

describe('AC 1, upstream JSON is served as JSON with the body unchanged', () => {
  it.each([
    'application/json',
    'application/problem+json',
    'application/geo+json',
    'application/vnd.api+json',
    'application/json-patch+json',
    'application/json; charset=iso-8859-1',
    'application/problem+json;charset=utf-8',
    'APPLICATION/JSON',
    'Application/Problem+JSON',
    '  application/geo+json  ;profile=x',
  ])('serves %s as application/json; charset=utf-8', async (type) => {
    upstream(200, type, '{"a":1}')
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(await res.text()).toBe('{"a":1}')
  })
})

describe('AC 2, every other or missing upstream type is an inert text download', () => {
  it.each([
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'text/plain',
    'application/octet-stream',
  ])('%s is served as text/plain; charset=utf-8 with an attachment disposition', async (type) => {
    upstream(503, type, BODY)
    const res = await call()
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(await res.text()).toBe(BODY)
  })

  it('serves a missing upstream content type as text/plain with an attachment disposition', async () => {
    upstream(200, null, 'no type here')
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(await res.text()).toBe('no type here')
  })

  it.each(['application/jsonx', 'application/json+xml', 'text/json', 'application/ld']) (
    '%s is not JSON and is served as a text download',
    async (type) => {
      upstream(200, type, 'x')
      const res = await call()
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(res.headers.get('content-disposition')).toBe('attachment')
    },
  )
})

describe('AC 3, every answer of the catch-all carries nosniff itself', () => {
  it('a JSON answer carries X-Content-Type-Options: nosniff', async () => {
    upstream(200, 'application/json', '{}')
    const res = await call()
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('a text download answer carries X-Content-Type-Options: nosniff', async () => {
    upstream(200, 'text/html', BODY)
    const res = await call()
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it.each([
    ['401', async () => {
      vi.mocked(isAuthenticated).mockReturnValue(false)
      return call()
    }],
    ['400', async () => call({ 'x-gateway-url': 'http://evil.example.com' })],
    ['502', async () => {
      fetchMock.mockImplementation(async () => { throw new Error('gateway down') })
      return call()
    }],
  ])('the %s error answer carries X-Content-Type-Options: nosniff', async (_code, make) => {
    const res = await make()
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('AC 4, error answers keep their status, JSON type and body', () => {
  it('the unauthorized answer is an unchanged 401 JSON error', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const res = await call()
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a non-allowlisted gateway URL is an unchanged 400 JSON error', async () => {
    const res = await call({ 'x-gateway-url': 'http://evil.example.com' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(await res.json()).toEqual({ error: 'Gateway URL must use https' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failing gateway fetch is an unchanged 502 JSON error', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('gateway down') })
    const res = await call()
    expect(res.status).toBe(502)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(await res.json()).toEqual({ error: 'gateway down' })
  })
})
