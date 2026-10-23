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
 * - A route imports only modules on ALLOWED_ROUTE_IMPORTS, the ones the
 *   routes use today. Anything else (an HTTP or socket client such as node:http,
 *   undici or ws, a module that might wrap one, a relative path, a computed
 *   specifier) fails, whatever form the import takes: static, side-effect,
 *   re-export, dynamic or require. `createRequire`, `process.binding` and the global
 *   WebSocket, EventSource and XMLHttpRequest are flagged too, because they
 *   load or are a client without a module specifier. This is an allowlist, not
 *   a list of banned clients, so a client nobody thought of is refused too.
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

/**
 * Modules a route under src/app/api may import: the ones the routes import
 * today. None of them is an HTTP or socket client, and the `@/lib` modules
 * reach a gateway only through gateway.ts. A route that needs another module
 * adds it here with a reason, which makes the addition a reviewed line. Names
 * are compared without a `node:` prefix.
 */
const ALLOWED_ROUTE_IMPORTS: Record<string, string> = {
  'next/server': 'request and response types',
  '@/lib/auth': 'session check',
  '@/lib/gateway': 'the gateway helpers (the only way to a gateway)',
  '@/lib/agent-registry': 'the registry of connected agents',
  '@/lib/data-store': 'local JSON stores',
  '@/lib/input-validators': 'request value checks',
  '@/lib/service-health': 'health probe of the operator-configured URLs',
  '@/lib/github-ci': 'check runs of the fixed GitHub host',
  '@/types': 'types',
  bcryptjs: 'token hashing',
  child_process: 'spawn of the local docker CLI',
  crypto: 'hashing and random ids',
  fs: 'local files',
  path: 'path joining',
}

/** `(import|require)(` call sites, with the argument text that follows the parenthesis. */
function callSites(code: string): string[] {
  return [...code.matchAll(/\b(?:import|require)\s*\(([\s\S]{0,400})/g)].map((m) => m[1])
}

/**
 * Every way a route can load code or a client that is not on the allowlist,
 * as human-readable offences: a module specifier that is not allowed (static
 * import, side-effect import, re-export, dynamic import, require), a computed
 * specifier, createRequire, process.binding and the global clients.
 */
function routeImportViolations(text: string): string[] {
  const code = stripComments(text)
  const specifiers = [
    ...[...code.matchAll(/\bfrom\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]),
    ...[...code.matchAll(/\bimport\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]),
  ]
  const offences: string[] = []
  for (const arg of callSites(code)) {
    const literal = arg.match(/^\s*(['"`])([^'"`$\\]*)\1\s*[,)]/)
    if (literal) specifiers.push(literal[2])
    else offences.push('a computed import() or require() specifier')
  }
  for (const spec of specifiers) {
    if (!(spec.replace(/^node:/, '') in ALLOWED_ROUTE_IMPORTS)) offences.push(`import of '${spec}', which is not on ALLOWED_ROUTE_IMPORTS`)
  }
  if (/\bcreateRequire\b|\bprocess\s*\.\s*(?:binding|dlopen)\b/.test(code)) {
    offences.push('createRequire or process.binding (loads a module or a native client without a visible specifier)')
  }
  if (/\b(?:WebSocket|EventSource|XMLHttpRequest)\b/.test(code)) offences.push('a global WebSocket, EventSource or XMLHttpRequest client')
  return offences
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

  it('flags every way of loading a module that is not on the allowlist', () => {
    expect(routeImportViolations("import http from 'node:http'")).toHaveLength(1)
    expect(routeImportViolations('import { request } from "https"')).toHaveLength(1)
    expect(routeImportViolations("import * as net from 'node:net'")).toHaveLength(1)
    expect(routeImportViolations("import { connect } from 'node:tls'")).toHaveLength(1)
    expect(routeImportViolations("import { connect } from 'http2'")).toHaveLength(1)
    expect(routeImportViolations("import { request } from 'undici'")).toHaveLength(1)
    expect(routeImportViolations("import 'node:net'")).toHaveLength(1)
    expect(routeImportViolations("const { Agent } = require('undici')")).toHaveLength(1)
    expect(routeImportViolations("const m = await import('node:https')")).toHaveLength(1)
    expect(routeImportViolations("import WebSocket from 'ws'")).toContainEqual(expect.stringContaining("import of 'ws'"))
    expect(routeImportViolations("import { createSocket } from 'node:dgram'")).toContainEqual(expect.stringContaining("import of 'node:dgram'"))
    expect(routeImportViolations("export * from 'undici'")).toHaveLength(1)
    expect(routeImportViolations("import { x } from './local-client'")).toHaveLength(1)
    expect(routeImportViolations("import { x } from '../../../lib/gateway'")).toHaveLength(1)
    expect(routeImportViolations('import type { Dispatcher } from "undici"')).toHaveLength(1)
  })

  it('flags an import anywhere on a line, not only at its start', () => {
    expect(routeImportViolations("import { NextRequest } from 'next/server'; import 'undici'")).toHaveLength(1)
    expect(routeImportViolations("import 'undici'; import { NextRequest } from 'next/server'")).toHaveLength(1)
    expect(routeImportViolations("export const x = 1; const m = await import('undici')")).toHaveLength(1)
  })

  it('flags an import spread over several lines', () => {
    expect(routeImportViolations("import {\n  request,\n  Agent,\n} from\n  'undici'")).toHaveLength(1)
  })

  it('flags a computed specifier, createRequire and the global clients', () => {
    expect(routeImportViolations('const m = await import(name)')).toHaveLength(1)
    expect(routeImportViolations('const m = require(`un${x}`)')).toHaveLength(1)
    expect(routeImportViolations("const r = createRequire(import.meta.url)('undici')").length).toBeGreaterThan(0)
    expect(routeImportViolations("import { createRequire } from 'node:module'")).toHaveLength(2)
    expect(routeImportViolations('const r = module.require(x)')).toHaveLength(1)
    expect(routeImportViolations("const t = process.binding('tcp_wrap')")).toHaveLength(1)
    expect(routeImportViolations("process.dlopen(m, '/x.node')")).toHaveLength(1)
    expect(routeImportViolations("const ws = new WebSocket('wss://x')")).toHaveLength(1)
    expect(routeImportViolations("const es = new EventSource('https://x')")).toHaveLength(1)
    expect(routeImportViolations('const x = new XMLHttpRequest()')).toHaveLength(1)
    expect(routeImportViolations("import WebSocket from 'ws'; export const p = (u: string) => new WebSocket(u)")).toHaveLength(2)
  })

  it('does not flag allowlisted modules, with or without the node: prefix, or comments', () => {
    expect(routeImportViolations("import { NextRequest, NextResponse } from 'next/server'")).toEqual([])
    expect(routeImportViolations("import { spawn } from 'child_process'")).toEqual([])
    expect(routeImportViolations("import { spawn } from 'node:child_process'")).toEqual([])
    expect(routeImportViolations("import fs from 'node:fs'")).toEqual([])
    expect(routeImportViolations("import { gatewayFetch } from '@/lib/gateway'")).toEqual([])
    expect(routeImportViolations("import {\n  gatewayFetch,\n  remoteGatewayFetch,\n} from '@/lib/gateway'")).toEqual([])
    expect(routeImportViolations("// import http from 'node:http'\nconst a = 1")).toEqual([])
    expect(routeImportViolations("/* import 'undici' */ const a = 1")).toEqual([])
    expect(routeImportViolations("const m = Array.from('abc')")).toEqual([])
  })

  it('does not flag a name that merely contains an allowed or banned name', () => {
    expect(routeImportViolations("import { x } from '@/lib/gateway-extra'")).toHaveLength(1)
    expect(routeImportViolations("import { y } from 'node:fs/promises'")).toHaveLength(1)
    expect(routeImportViolations('const WebSocketLike = 1')).toEqual([])
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

  it('has no route that imports a module outside the allowlist or loads a client of its own', () => {
    const offenders = routes.flatMap((r) => routeImportViolations(r.text).map((v) => `${r.rel}: ${v}`))
    expect(offenders).toEqual([])
  })

  it('keeps every allowlist entry in use, so the list stays the routes\' real imports', () => {
    const used = new Set(
      routes.flatMap((r) => [...stripComments(r.text).matchAll(/\bfrom\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2].replace(/^node:/, ''))),
    )
    expect(Object.keys(ALLOWED_ROUTE_IMPORTS).filter((name) => !used.has(name))).toEqual([])
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
