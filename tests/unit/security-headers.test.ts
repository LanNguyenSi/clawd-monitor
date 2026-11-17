import { describe, it, expect, afterEach, vi } from 'vitest'
import nextConfig, { buildSecurityHeaders } from '../../next.config.mjs'
// @ts-expect-error Next's bundled path-to-regexp ships no types
import { match } from '../../node_modules/next/dist/compiled/path-to-regexp/index.js'

type Header = { key: string; value: string }
type Rule = { source: string; headers: Header[] }
const byKey = (h: Header[]) => Object.fromEntries(h.map((x) => [x.key, x.value]))
const rulesFor = (env: string) => {
  vi.stubEnv('NODE_ENV', env)
  return (nextConfig as { headers: () => Promise<Rule[]> }).headers()
}

const COMMON = [
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
const csp = (scriptSrc: string) => [COMMON[0], `script-src ${scriptSrc}`, ...COMMON.slice(1)].join('; ')
const PROD_CSP = csp("'self' 'unsafe-inline'")
const DEV_CSP = csp("'self' 'unsafe-inline' 'unsafe-eval'")

afterEach(() => vi.unstubAllEnvs())

describe('security headers', () => {
  it('applies one rule to pages and API routes alike', async () => {
    const rules = await rulesFor('production')
    expect(rules).toHaveLength(1)
    const matches = match(rules[0].source)
    for (const path of ['/', '/dashboard', '/login', '/settings', '/api/health', '/api/agents/list', '/api/stream/metrics', '/api/proxy/docker']) {
      expect(matches(path), path).not.toBe(false)
    }
  })

  it('sends the exact production header set from headers()', async () => {
    const [rule] = await rulesFor('production')
    expect(rule.headers).toEqual([
      { key: 'Content-Security-Policy', value: PROD_CSP },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ])
    expect(PROD_CSP).not.toContain("'unsafe-eval'")
  })

  it.each(['development', 'test'])('sends the exact header set with unsafe-eval under NODE_ENV=%s', async (env) => {
    const [rule] = await rulesFor(env)
    expect(byKey(rule.headers)['Content-Security-Policy']).toBe(DEV_CSP)
    expect(byKey(rule.headers)['X-Content-Type-Options']).toBe('nosniff')
  })

  it('builds the policy from the flag alone', () => {
    expect(byKey(buildSecurityHeaders(true))['Content-Security-Policy']).toBe(PROD_CSP)
    expect(byKey(buildSecurityHeaders(false))['Content-Security-Policy']).toBe(DEV_CSP)
  })

  it('does not send Strict-Transport-Security (TLS is the proxy\'s)', () => {
    expect(byKey(buildSecurityHeaders(true))['Strict-Transport-Security']).toBeUndefined()
  })

  it('carries no hash or nonce source, so the inline hydration scripts keep running', () => {
    // A hash or nonce source makes browsers ignore 'unsafe-inline' and block
    // Next's own inline scripts and the theme script.
    expect(PROD_CSP).not.toMatch(/'(sha(256|384|512)|nonce)-/)
    expect(byKey(buildSecurityHeaders(true))['Content-Security-Policy']).not.toMatch(/'(sha(256|384|512)|nonce)-/)
  })
})
