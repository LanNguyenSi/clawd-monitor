import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import nextConfig, { buildSecurityHeaders } from '../../next.config.mjs'
// @ts-expect-error Next's bundled path-to-regexp ships no types
import { match } from '../../node_modules/next/dist/compiled/path-to-regexp/index.js'

type Header = { key: string; value: string }
const byKey = (h: Header[]) => Object.fromEntries(h.map((x) => [x.key, x.value]))

describe('security headers', () => {
  it('applies one rule to pages and API routes alike', async () => {
    const rules = await (nextConfig as { headers: () => Promise<Array<{ source: string; headers: Header[] }>> }).headers()
    expect(rules).toHaveLength(1)
    const matches = match(rules[0].source)
    for (const path of ['/', '/dashboard', '/login', '/settings', '/api/health', '/api/agents/list', '/api/stream/metrics', '/api/proxy/docker']) {
      expect(matches(path), path).not.toBe(false)
    }
    expect(byKey(rules[0].headers)).toEqual(byKey(buildSecurityHeaders(process.env.NODE_ENV === 'production')))
  })

  it('sets the content type, referrer and framing headers', () => {
    const h = byKey(buildSecurityHeaders(true))
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('same-origin')
    expect(h['X-Frame-Options']).toBe('DENY')
  })

  it('sends a CSP that forbids framing and remote connections', () => {
    const csp = byKey(buildSecurityHeaders(true))['Content-Security-Policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('allows unsafe-eval for scripts only outside production', () => {
    const script = (prod: boolean) =>
      byKey(buildSecurityHeaders(prod))['Content-Security-Policy'].split('; ').find((d) => d.startsWith('script-src'))
    expect(script(true)).not.toContain("'unsafe-eval'")
    expect(script(false)).toContain("'unsafe-eval'")
  })

  it('does not send Strict-Transport-Security (TLS is the proxy\'s)', () => {
    expect(byKey(buildSecurityHeaders(true))['Strict-Transport-Security']).toBeUndefined()
  })

  it('keeps the inline theme script to a form the policy permits', () => {
    // The theme script is inline, so script-src must keep 'unsafe-inline'. A
    // hash source would make browsers ignore it and block Next's own inline
    // hydration scripts, so the policy must not carry one.
    const csp = byKey(buildSecurityHeaders(true))['Content-Security-Policy']
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toMatch(/'sha(256|384|512)-/)
    const layout = readFileSync(join(__dirname, '../../src/app/layout.tsx'), 'utf8')
    expect(layout).toContain('dangerouslySetInnerHTML')
  })
})
