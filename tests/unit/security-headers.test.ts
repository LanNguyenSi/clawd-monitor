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

afterEach(() => vi.unstubAllEnvs())

describe('static security headers', () => {
  it('applies one rule to pages and API routes alike', async () => {
    const rules = await rulesFor('production')
    expect(rules).toHaveLength(1)
    const matches = match(rules[0].source)
    for (const path of ['/', '/dashboard', '/login', '/settings', '/api/health', '/api/agents/list', '/api/stream/metrics', '/api/proxy/docker']) {
      expect(matches(path), path).not.toBe(false)
    }
  })

  it.each(['production', 'development', 'test'])('sends exactly the three static headers under NODE_ENV=%s', async (env) => {
    const [rule] = await rulesFor(env)
    expect(rule.headers).toEqual([
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ])
  })

  it('sends no Content-Security-Policy from the config, so the middleware one is the only one', async () => {
    for (const env of ['production', 'development']) {
      const [rule] = await rulesFor(env)
      expect(byKey(rule.headers)['Content-Security-Policy'], env).toBeUndefined()
    }
    expect(byKey(buildSecurityHeaders())['Content-Security-Policy']).toBeUndefined()
  })

  it('does not send Strict-Transport-Security (TLS is the proxy\'s)', () => {
    expect(byKey(buildSecurityHeaders())['Strict-Transport-Security']).toBeUndefined()
  })
})
