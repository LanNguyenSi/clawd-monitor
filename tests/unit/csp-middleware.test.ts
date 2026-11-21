import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildCsp, generateNonce } from '@/lib/csp'
import { middleware, config } from '@/middleware'
// @ts-expect-error Next's bundled path-to-regexp ships no types
import { match } from '../../node_modules/next/dist/compiled/path-to-regexp/index.js'

const NONCE_SOURCE = /^[A-Za-z0-9+/]{22}==$/
const run = (path = '/dashboard', env = 'production') => {
  vi.stubEnv('NODE_ENV', env)
  return middleware(new NextRequest(`http://127.0.0.1:3160${path}`))
}
const scriptSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('script-src ')) as string

afterEach(() => vi.unstubAllEnvs())

describe('generateNonce', () => {
  it('encodes 128 random bits as base64', () => {
    expect(generateNonce()).toMatch(NONCE_SOURCE)
  })

  it('differs between calls', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce))
    expect(nonces.size).toBe(50)
  })
})

describe('buildCsp', () => {
  it('production: script-src is self plus the nonce, no unsafe-inline, no unsafe-eval', () => {
    const csp = buildCsp('abc123==', true)
    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-abc123=='")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'")
    expect(scriptSrc(csp)).not.toContain('strict-dynamic')
  })

  it('development adds unsafe-eval to script-src only', () => {
    expect(scriptSrc(buildCsp('abc123==', false))).toBe("script-src 'self' 'nonce-abc123==' 'unsafe-eval'")
  })

  it('keeps every other directive, style-src included, in both modes', () => {
    const others = (csp: string) => csp.split('; ').filter((d) => !d.startsWith('script-src '))
    const expected = [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]
    expect(others(buildCsp('n==', true))).toEqual(expected)
    expect(others(buildCsp('n==', false))).toEqual(expected)
  })
})

describe('middleware', () => {
  const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1]

  it('sets one production CSP with a nonce on the response', () => {
    const res = run('/dashboard', 'production')
    const csp = res.headers.get('Content-Security-Policy') as string
    expect(scriptSrc(csp)).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/]{22}=='$/)
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'")
  })

  it('hands the same nonce and the same CSP to rendering through the request headers', () => {
    const res = run()
    const csp = res.headers.get('Content-Security-Policy') as string
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp))
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
  })

  it('does not leak the nonce header to the client', () => {
    expect(run().headers.get('x-nonce')).toBeNull()
  })

  it('generates a fresh nonce for every request', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => nonceOf(run().headers.get('Content-Security-Policy') as string)))
    expect(nonces.size).toBe(20)
  })

  it('adds unsafe-eval outside production only', () => {
    expect(scriptSrc(run('/login', 'development').headers.get('Content-Security-Policy') as string)).toContain("'unsafe-eval'")
    expect(scriptSrc(run('/login', 'production').headers.get('Content-Security-Policy') as string)).not.toContain("'unsafe-eval'")
  })

  it('ignores a CSP or nonce header sent by the client', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = middleware(
      new NextRequest('http://127.0.0.1:3160/login', {
        headers: { 'x-nonce': 'attacker==', 'content-security-policy': "script-src 'unsafe-inline'" },
      }),
    )
    const csp = res.headers.get('Content-Security-Policy') as string
    expect(csp).not.toContain('attacker')
    expect(csp).not.toContain("script-src 'unsafe-inline'")
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp))
  })
})

describe('middleware matcher', () => {
  const [source] = config.matcher
  const matches = match(source)
  it.each(['/', '/login', '/dashboard', '/settings', '/api/health', '/api/agents/list', '/api/stream/metrics', '/api/proxy/docker'])(
    'covers %s',
    (path) => expect(matches(path)).not.toBe(false),
  )
  it.each(['/_next/static/chunks/main.js', '/_next/image', '/favicon.svg'])('skips %s', (path) => {
    expect(matches(path)).toBe(false)
  })
})
