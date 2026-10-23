/**
 * Structural pin for the gateway guard. Everything under src/app/api reaches a
 * gateway only through gateway.ts:
 *
 * - No route calls, or even names, `fetch` or `pinnedFetch` itself (a raw fetch
 *   on a gateway URL would skip the port rule, the allowlist and the DNS
 *   pinning). Routes that legitimately call fetch for something that is not a
 *   gateway are listed in NON_GATEWAY_FETCH with the reason.
 * - A route that reads an agent's reported `gatewayUrl` or `gatewayToken` (the
 *   URL a remote party chose) fetches through remoteGatewayFetch only, which
 *   has no default-URL exemption, and never through gatewayFetch.
 * - No route calls the URL assertions itself instead of a fetch helper.
 * - No route imports an HTTP or socket client of its own (node:http,
 *   node:https, node:net, node:tls, node:http2 or undici), which would reach a
 *   gateway around the guard as a raw fetch would.
 *
 * The rules are text scans, so they are generic over files: a new route, or an
 * edit to an existing one, is judged without this file being touched. They do
 * not follow a URL that reaches a route through another module; that case is
 * the job of the type-required `urlSource` of gatewayFetch (see gateway.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** Block comments and whole-line or trailing `// ` comments, so prose does not trip the scans. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** Any use of the identifier `fetch` or `pinnedFetch` (a call, an alias, `globalThis.fetch`). */
function usesRawFetch(text: string): boolean {
  return /\b(?:pinnedFetch|fetch)\b/.test(stripComments(text))
}

/** Imports, requires or dynamically imports an HTTP or socket client module. */
function importsRawTransport(text: string): boolean {
  return /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"`](?:node:)?(?:http|https|http2|net|tls|undici)['"`]/m.test(
    stripComments(text),
  )
}

/** Reads an agent's reported gateway fields: `x.gatewayUrl`, `x?.gatewayToken`, `x['gatewayUrl']`, `{ gatewayUrl } = x`. */
function readsAgentGatewayFields(text: string): boolean {
  const code = stripComments(text)
  return (
    /\??\.\s*gateway(?:Url|Token)\b/.test(code) ||
    /\[\s*['"`]gateway(?:Url|Token)['"`]\s*\]/.test(code) ||
    /\{[^}]*\bgateway(?:Url|Token)\b[^}]*\}\s*=[^=]/.test(code)
  )
}

/** Imports the agent registry (the source of agent-reported URLs). */
function importsAgentRegistry(text: string): boolean {
  return /from\s+['"]@\/lib\/agent-registry['"]/.test(stripComments(text))
}

function callsGatewayFetch(text: string): boolean {
  return /(?<![A-Za-z0-9_$])gatewayFetch\s*\(/.test(stripComments(text))
}

function callsRemoteGatewayFetch(text: string): boolean {
  return /\bremoteGatewayFetch\s*\(/.test(stripComments(text))
}

const API_ROOT = join(__dirname, '..', '..', 'src', 'app', 'api')
const routes = sourceFiles(API_ROOT).map((file) => ({
  file,
  rel: relative(API_ROOT, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}))

/** Routes that call fetch for something that is not a gateway, by path under src/app/api. */
const NON_GATEWAY_FETCH: Record<string, string> = {
  'proxy/health/route.ts': 'probes the operator-configured SERVICE_HEALTH_URLS, not a gateway',
  'proxy/github/route.ts': 'calls the fixed api.github.com host',
}

describe('gateway consumers, scan rules on sample sources', () => {
  it('flags a raw fetch call, an alias of fetch, a global fetch and pinnedFetch', () => {
    expect(usesRawFetch("const r = await fetch(url + '/status')")).toBe(true)
    expect(usesRawFetch('const f = fetch; await f(url)')).toBe(true)
    expect(usesRawFetch('await globalThis.fetch(url)')).toBe(true)
    expect(usesRawFetch("import { pinnedFetch } from '@/lib/pinned-fetch'")).toBe(true)
    expect(usesRawFetch('await pinnedFetch(url)')).toBe(true)
  })

  it('does not flag the gateway helpers or prose in comments', () => {
    expect(usesRawFetch("await gatewayFetch('/x', { urlSource: 'operator' })")).toBe(false)
    expect(usesRawFetch("await remoteGatewayFetch(base, '/x')")).toBe(false)
    expect(usesRawFetch('// we fetch the gateway logs here\nconst a = 1')).toBe(false)
    expect(usesRawFetch('/* pinnedFetch is not used here */ const a = 1')).toBe(false)
  })

  it('does not let a URL in a string hide a fetch after it on the same line', () => {
    expect(usesRawFetch("const u = 'http://x'; await fetch(u)")).toBe(true)
  })

  it('flags every way of loading an HTTP or socket client', () => {
    expect(importsRawTransport("import http from 'node:http'")).toBe(true)
    expect(importsRawTransport('import { request } from "https"')).toBe(true)
    expect(importsRawTransport("import * as net from 'node:net'")).toBe(true)
    expect(importsRawTransport("import { connect } from 'node:tls'")).toBe(true)
    expect(importsRawTransport("import { connect } from 'http2'")).toBe(true)
    expect(importsRawTransport("import { request } from 'undici'")).toBe(true)
    expect(importsRawTransport("import 'node:net'")).toBe(true)
    expect(importsRawTransport("const { Agent } = require('undici')")).toBe(true)
    expect(importsRawTransport("const m = await import('node:https')")).toBe(true)
  })

  it('does not flag other modules, names that merely contain a client name, or comments', () => {
    expect(importsRawTransport("import { NextRequest } from 'next/server'")).toBe(false)
    expect(importsRawTransport("import { spawn } from 'child_process'")).toBe(false)
    expect(importsRawTransport("import { x } from '@/lib/http-helpers'")).toBe(false)
    expect(importsRawTransport("import { y } from 'node:netlink'")).toBe(false)
    expect(importsRawTransport("// import http from 'node:http'\nconst a = 1")).toBe(false)
  })

  it('flags every way of reading the agent-reported gateway fields', () => {
    expect(readsAgentGatewayFields("const u = registry.agents.get(id)?.gatewayUrl")).toBe(true)
    expect(readsAgentGatewayFields('const t = agent.gatewayToken')).toBe(true)
    expect(readsAgentGatewayFields("const u = agent['gatewayUrl']")).toBe(true)
    expect(readsAgentGatewayFields('const { gatewayUrl, name } = agent')).toBe(true)
  })

  it('does not flag a local variable named gatewayUrl or an object built from it', () => {
    expect(readsAgentGatewayFields("const gatewayUrl = req.headers.get('x-gateway-url') ?? undefined")).toBe(false)
    expect(readsAgentGatewayFields("await gatewayFetch('/x', { gatewayUrl, urlSource: 'operator' })")).toBe(false)
    expect(readsAgentGatewayFields('// agent.gatewayUrl is checked by remoteGatewayFetch')).toBe(false)
  })

  it('tells gatewayFetch from remoteGatewayFetch', () => {
    expect(callsGatewayFetch("await gatewayFetch('/x')")).toBe(true)
    expect(callsGatewayFetch("await remoteGatewayFetch(u, '/x')")).toBe(false)
    expect(callsRemoteGatewayFetch("await remoteGatewayFetch(u, '/x')")).toBe(true)
    expect(callsRemoteGatewayFetch("await gatewayFetch('/x')")).toBe(false)
  })
})

describe('gateway consumers', () => {
  it('finds the route files it is meant to scan', () => {
    expect(routes.length).toBeGreaterThan(10)
    expect(routes.some((r) => r.rel === 'agents/[agentId]/logs/route.ts')).toBe(true)
    for (const rel of Object.keys(NON_GATEWAY_FETCH)) {
      expect(routes.some((r) => r.rel === rel)).toBe(true)
    }
  })

  it('has no route that names fetch or pinnedFetch, apart from the listed non-gateway ones', () => {
    const offenders = routes.filter((r) => !(r.rel in NON_GATEWAY_FETCH) && usesRawFetch(r.text)).map((r) => r.rel)
    expect(offenders).toEqual([])
  })

  it('keeps the listed non-gateway fetch routes away from gateway URLs and tokens', () => {
    for (const rel of Object.keys(NON_GATEWAY_FETCH)) {
      const route = routes.find((r) => r.rel === rel)!
      expect(readsAgentGatewayFields(route.text)).toBe(false)
      expect(callsGatewayFetch(route.text) || callsRemoteGatewayFetch(route.text)).toBe(false)
      expect(importsAgentRegistry(route.text)).toBe(false)
    }
  })

  it('has no route that loads an HTTP or socket client of its own', () => {
    const offenders = routes.filter((r) => importsRawTransport(r.text)).map((r) => r.rel)
    expect(offenders).toEqual([])
  })

  it('has no route that calls the URL assertion itself instead of a fetch helper', () => {
    const offenders = routes.filter((r) => /assert(Remote)?GatewayUrl(Allowed)?\s*\(/.test(stripComments(r.text))).map((r) => r.rel)
    expect(offenders).toEqual([])
  })

  it('has no route that reads an agent-reported gateway field without fetching through remoteGatewayFetch only', () => {
    const readers = routes.filter((r) => readsAgentGatewayFields(r.text))
    // The scan must have something to judge, or the rule is vacuous.
    expect(readers.map((r) => r.rel)).toContain('agents/[agentId]/logs/route.ts')
    const offenders = readers.filter((r) => !callsRemoteGatewayFetch(r.text) || callsGatewayFetch(r.text)).map((r) => r.rel)
    expect(offenders).toEqual([])
  })

  it('has no route that imports the agent registry and also calls gatewayFetch', () => {
    const offenders = routes.filter((r) => importsAgentRegistry(r.text) && callsGatewayFetch(r.text)).map((r) => r.rel)
    expect(offenders).toEqual([])
  })

  it('fetches the agent-reported gateway URL through remoteGatewayFetch with the URL itself as the base', () => {
    const route = routes.find((r) => r.rel === 'agents/[agentId]/logs/route.ts')!
    expect(route.text).toMatch(/remoteGatewayFetch\(\s*agent\.gatewayUrl/)
    expect(route.text).not.toMatch(/urlSource/)
  })
})
