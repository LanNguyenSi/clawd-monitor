/**
 * Structural pin for the gateway guard: every route that fetches a gateway URL
 * reaches it through gateway.ts, and the one route that handles a URL a remote
 * party chose (the agent's reported gatewayUrl) uses remoteGatewayFetch, which
 * has no default-URL exemption. A raw `fetch(` on a gateway URL, or a direct
 * call of the URL assertion from a route, would bypass the DNS pinning and the
 * port rule, so this test fails when one appears.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const API_ROOT = join(__dirname, '..', '..', 'src', 'app', 'api')
const routes = sourceFiles(API_ROOT).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

describe('gateway consumers', () => {
  it('finds the route files it is meant to scan', () => {
    expect(routes.length).toBeGreaterThan(10)
    expect(routes.some((r) => r.file.endsWith(join('agents', '[agentId]', 'logs', 'route.ts')))).toBe(true)
  })

  it('has no route that calls fetch on a gateway URL directly', () => {
    const offenders = routes.filter((r) => /\bfetch\([^)]*[gG]atewayUrl/.test(r.text)).map((r) => r.file)
    expect(offenders).toEqual([])
  })

  it('has no route that calls the URL assertion itself instead of a fetch helper', () => {
    const offenders = routes.filter((r) => /assert(Remote)?GatewayUrl(Allowed)?\(/.test(r.text)).map((r) => r.file)
    expect(offenders).toEqual([])
  })

  it('fetches the agent-reported gateway URL through remoteGatewayFetch only', () => {
    const route = routes.find((r) => r.file.endsWith(join('agents', '[agentId]', 'logs', 'route.ts')))!
    expect(route.text).toMatch(/remoteGatewayFetch\(\s*agent\.gatewayUrl/)
    expect(route.text).not.toMatch(/\bgatewayFetch\(/)
    expect(route.text).not.toMatch(/trustDefault/)
  })
})
