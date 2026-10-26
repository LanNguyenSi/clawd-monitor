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
 *   specifier) fails in the usual import forms: static, side-effect,
 *   re-export, dynamic or require with a literal specifier. `createRequire`, `process.binding` and the global
 *   WebSocket, EventSource and XMLHttpRequest are flagged too, because they
 *   load or are a client without a module specifier. This is an allowlist, not
 *   a list of banned clients, so a client nobody thought of is refused too.
 * - `child_process` is not on that allowlist either. It is allowed per file,
 *   for the routes named in ROUTES_ALLOWED_CHILD_PROCESS with the process each
 *   one runs; any other route that loads it, in any of those forms, fails.
 * - The `@/lib` modules a route may import are scanned too, transitively
 *   through their own `@/lib/...` and relative imports, for anything that can
 *   open a socket or start a process behind the route that imports them: the
 *   transport modules (net, tls, http, https, http2, dgram, child_process,
 *   undici, ws, with or without `node:`), createRequire and process.binding, a
 *   raw fetch, and the global WebSocket, EventSource and XMLHttpRequest. Only
 *   the files that are the guarded transport layer itself may have those, and
 *   they are each named with a reason in TRUSTED_TRANSPORT_LIBS; every other
 *   reachable lib file must be clean. There an `import type` statement and a
 *   type annotation are not a use, because TypeScript erases them and they
 *   load nothing at run time.
 * - It is a text scan: deliberate obfuscation (an aliased require, eval, a
 *   computed global name) is out of its scope; the runtime guard in
 *   src/lib/gateway.ts and src/lib/pinned-fetch.ts stays the boundary.
 *
 * The rules are text scans, so they are generic over files: a new route, or an
 * edit to an existing one, is judged without this file being touched. They do
 * not follow a URL that reaches a route through another module; that case is
 * the job of the type-required `urlSource` of gatewayFetch (see gateway.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

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
 * today. None of them is an HTTP or socket client, and the `@/lib` modules are
 * scanned themselves for a client of their own (see TRUSTED_TRANSPORT_LIBS).
 * A route that needs another module adds it here with a reason, which makes
 * the addition a reviewed line. Names are compared without a `node:` prefix.
 * `child_process` is deliberately absent: it is allowed per file, below.
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
  crypto: 'hashing and random ids',
  fs: 'local files',
  path: 'path joining',
}

/**
 * Routes that may load `child_process`, by path under src/app/api, with the
 * process each one runs. A started process can reach anything the guard can be
 * shown a URL for (curl, docker, an agent binary) without the guard seeing it,
 * so this is a per-file permission and not an allowlist entry: a new route that
 * wants a process is a reviewed line here.
 */
const ROUTES_ALLOWED_CHILD_PROCESS: Record<string, string> = {
  'containers/route.ts': 'runs `docker ps` to list the containers of this host',
  'stream/logs/route.ts': 'spawns `docker logs`, `journalctl` and `tail` to follow log output',
  'proxy/docker/route.ts': 'runs `docker ps -a` and `docker inspect` for the docker status proxy',
}

/** `(import|require)(` call sites, with the argument text that follows the parenthesis. */
function callSites(code: string): string[] {
  return [...code.matchAll(/\b(?:import|require)\s*\(([\s\S]{0,400})/g)].map((m) => m[1])
}

/**
 * The module specifiers a piece of code names (static import, side-effect
 * import, re-export, dynamic import, require with a literal specifier) and how
 * many specifiers it computes at run time instead.
 */
function importedSpecifiers(code: string): { specs: string[]; computed: number } {
  const specs = [
    ...[...code.matchAll(/\bfrom\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]),
    ...[...code.matchAll(/\bimport\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]),
  ]
  let computed = 0
  for (const arg of callSites(code)) {
    const literal = arg.match(/^\s*(['"`])([^'"`$\\]*)\1\s*[,)]/)
    if (literal) specs.push(literal[2])
    else computed += 1
  }
  return { specs, computed }
}

/**
 * Every way a route can load code or a client that is not allowed for it, as
 * human-readable offences: a module specifier that is not allowed (static
 * import, side-effect import, re-export, dynamic import, require), a computed
 * specifier, createRequire, process.binding and the global clients.
 * `rel` is the route path under src/app/api, which decides only whether
 * `child_process` is allowed for this file; null means "no file", so nothing
 * that is allowed per file is allowed at all.
 */
function routeImportViolations(text: string, rel: string | null = null): string[] {
  const code = stripComments(text)
  const { specs, computed } = importedSpecifiers(code)
  const offences: string[] = []
  for (let i = 0; i < computed; i++) offences.push('a computed import() or require() specifier')
  for (const spec of specs) {
    const name = spec.replace(/^node:/, '')
    if (name in ALLOWED_ROUTE_IMPORTS) continue
    if (name === 'child_process' && rel !== null && rel in ROUTES_ALLOWED_CHILD_PROCESS) continue
    if (name === 'child_process') {
      offences.push(`import of '${spec}', and child_process is allowed only for the routes in ROUTES_ALLOWED_CHILD_PROCESS`)
      continue
    }
    offences.push(`import of '${spec}', which is not on ALLOWED_ROUTE_IMPORTS`)
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

/** Everything a route can reach in src/lib starts at a `@/lib/...` allowlist entry. */
const LIB_PREFIX = '@/lib/'
const LIB_ROOT = join(__dirname, '..', '..', 'src', 'lib')

/**
 * Modules that open a socket, speak a protocol or start a process, with or
 * without the `node:` prefix. A route imports a `@/lib` module by name, so the
 * module is scanned for these too: a client inside `@/lib/data-store` would sit
 * behind every route that imports it, unseen by the route rules.
 */
const TRANSPORT_MODULES: readonly string[] = [
  'net',
  'tls',
  'http',
  'https',
  'http2',
  'dgram',
  'child_process',
  'undici',
  'ws',
]

/**
 * The lib modules that are the guarded transport layer, by path under src/lib.
 * These are the files the scan may find a transport capability in, because
 * running the URL policy and owning the one socket a route request lands on is
 * what they are for. A file is added here by reading it, never to silence a
 * failure: the failure names the file and the module to read.
 */
const TRUSTED_TRANSPORT_LIBS: Record<string, string> = {
  'gateway.ts': 'the gateway URL policy plus the operator default fetch, which is the boundary every other rule points at',
  'pinned-fetch.ts': 'the DNS-pinned undici transport: it opens the socket on purpose, after the URL policy has run',
}

/**
 * `import type ... from '...'` and `export type ... from '...'` statements.
 * TypeScript erases them, so they neither load a module nor construct a client.
 * A statement is matched as a whole, and only while it stays a single
 * specifier-free import head, so a type-only import can never swallow the
 * value import that follows it. `import { type X } from 'ws'` is not treated as
 * type-only (the whole statement is only erased when every binding is a type,
 * which is not worth reasoning about in a text scan).
 */
function stripTypeOnlyImports(code: string): string {
  return code.replace(
    /\b(?:import|export)\s+type\s+(?:(?!from\b)[^'"`;])*?\bfrom\s*(['"`])[^'"`]*\1/g,
    '',
  )
}

/**
 * A global client that is used rather than named in a type position. Only `ws:
 * WebSocket` and `Array<WebSocket>` are read as a type, so a bare reference
 * (`const w = WebSocket`) is an offence even though a type alias of the same
 * shape would be too: the scan errs towards flagging.
 */
function usesGlobalClient(code: string): boolean {
  return /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/.test(
    code.replace(/[:<]\s*\b(?:WebSocket|EventSource|XMLHttpRequest)\b/g, ''),
  )
}

/** The runtime module specifiers of a lib file (type-only imports erased). */
function libImportSpecifiers(text: string): string[] {
  return importedSpecifiers(stripTypeOnlyImports(stripComments(text))).specs
}

/**
 * What one lib file does that a module behind a route must not do: load a
 * transport module, load a module by a computed name or a native binding, call
 * fetch itself, or use a global client. Type positions are erased and are not
 * an offence here (the route rules keep their stricter text).
 */
function libFileViolations(rel: string, text: string): string[] {
  const code = stripTypeOnlyImports(stripComments(text))
  const { specs, computed } = importedSpecifiers(code)
  const offences = [] as string[]
  for (let i = 0; i < computed; i++) offences.push('a computed import() or require() specifier')
  for (const spec of specs) {
    if (TRANSPORT_MODULES.includes(spec.replace(/^node:/, ''))) {
      offences.push(`imports the transport module '${spec}', so it can open a socket or start a process`)
    }
  }
  if (/\bcreateRequire\b|\bprocess\s*\.\s*(?:binding|dlopen)\b/.test(code)) {
    offences.push('createRequire or process.binding (loads a module or a native client without a visible specifier)')
  }
  if (usesGlobalClient(code)) offences.push('a global WebSocket, EventSource or XMLHttpRequest client')
  if (usesRawFetch(code)) offences.push('calls fetch or pinnedFetch itself instead of going through the gateway helpers')
  return offences.map((o) => `${rel}: ${o}`)
}

/** Files under src/lib a specifier could name, mirroring the `@/*` alias and the `.js`-to-`.ts` rewrite. */
function libCandidates(fromRel: string, spec: string): string[] {
  let stem: string | null = null
  if (spec.startsWith(LIB_PREFIX)) stem = spec.slice(LIB_PREFIX.length)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const joined = posix.normalize(posix.join(posix.dirname(fromRel), spec))
    if (joined === '..' || joined.startsWith('../')) return []
    stem = joined
  }
  if (stem === null || stem === '' || stem === '.' || stem.startsWith('..')) return []
  const base = stem.replace(/\.(?:js|mjs|cjs|jsx)$/, '')
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
}

/** The one file a specifier names, or null when it is an outside module or nothing matches. */
function resolveLib(read: (rel: string) => string | null, fromRel: string, spec: string): string | null {
  return libCandidates(fromRel, spec).find((candidate) => read(candidate) !== null) ?? null
}

/** Every lib file reachable from `rootFiles` through runtime `@/lib/...` and relative imports. */
function collectReachableLibs(read: (rel: string) => string | null, rootFiles: string[]): Record<string, string> {
  const found: Record<string, string> = {}
  const queue = [...rootFiles]
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (rel in found) continue
    const text = read(rel)
    if (text === null) continue
    found[rel] = text
    for (const spec of libImportSpecifiers(text)) {
      const next = resolveLib(read, rel, spec)
      if (next !== null) queue.push(next)
    }
  }
  return found
}

/** Offences of a reachable lib graph: everything but the trusted transport files must be clean. */
function libGraphViolations(read: (rel: string) => string | null, rootFiles: string[]): string[] {
  return Object.entries(collectReachableLibs(read, rootFiles))
    .filter(([rel]) => !(rel in TRUSTED_TRANSPORT_LIBS))
    .flatMap(([rel, text]) => libFileViolations(rel, text))
}

/** Reads a lib file by its path under src/lib; null when there is no such file. */
function readLib(rel: string): string | null {
  try {
    return readFileSync(join(LIB_ROOT, rel), 'utf8')
  } catch {
    return null
  }
}

/** The same reader over an in-memory fixture tree, for the sample tests. */
function virtualLibs(files: Record<string, string>): (rel: string) => string | null {
  return (rel: string) => files[rel] ?? null
}

const allowedLibSpecs = Object.keys(ALLOWED_ROUTE_IMPORTS).filter((name) => name.startsWith(LIB_PREFIX))
const unresolvedAllowedLibs = allowedLibSpecs.filter((spec) => resolveLib(readLib, '', spec) === null)
const reachableLibFiles = allowedLibSpecs
  .map((spec) => resolveLib(readLib, '', spec))
  .filter((rel): rel is string => rel !== null)
const reachableLibSources = collectReachableLibs(readLib, reachableLibFiles)

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
    expect(routeImportViolations("import { spawn } from 'child_process'", 'stream/logs/route.ts')).toEqual([])
    expect(routeImportViolations("import { spawn } from 'node:child_process'", 'containers/route.ts')).toEqual([])
    expect(routeImportViolations("import fs from 'node:fs'")).toEqual([])
    expect(routeImportViolations("import { gatewayFetch } from '@/lib/gateway'")).toEqual([])
    expect(routeImportViolations("import {\n  gatewayFetch,\n  remoteGatewayFetch,\n} from '@/lib/gateway'")).toEqual([])
    expect(routeImportViolations("// import http from 'node:http'\nconst a = 1")).toEqual([])
    expect(routeImportViolations("/* import 'undici' */ const a = 1")).toEqual([])
    expect(routeImportViolations("const m = Array.from('abc')")).toEqual([])
  })

  it('compares module names exactly and ignores identifiers that only contain a client name', () => {
    expect(routeImportViolations("import { x } from '@/lib/gateway-extra'")).toHaveLength(1)
    expect(routeImportViolations("import { y } from 'node:fs/promises'")).toHaveLength(1)
    expect(routeImportViolations('const WebSocketLike = 1')).toEqual([])
  })

  it('allows child_process only for the routes on the per-file list, in every loading form', () => {
    const forms = [
      "import { execSync } from 'child_process'",
      "import { spawn } from 'node:child_process'",
      "import 'node:child_process'",
      "export { execSync } from 'child_process'",
      "const { execSync } = require('node:child_process')",
      "const m = await import('child_process')",
    ]
    for (const form of forms) {
      const expected = [expect.stringContaining('child_process')]
      expect(routeImportViolations(form, 'health/route.ts'), form).toEqual(expected)
      expect(routeImportViolations(form), form).toEqual(expected)
      for (const rel of Object.keys(ROUTES_ALLOWED_CHILD_PROCESS)) {
        expect(routeImportViolations(form, rel), `${form} in ${rel}`).toEqual([])
      }
    }
  })

  it('flags a lib module that loads a transport module, and excuses only a trusted transport file', () => {
    for (const spec of ['node:net', 'tls', 'http', 'https', 'http2', 'node:dgram', 'child_process', 'undici', 'ws']) {
      const text = `import c from '${spec}'\nexport const x = c`
      expect(libGraphViolations(virtualLibs({ 'input-validators.ts': text }), ['input-validators.ts']), spec).toEqual([
        `input-validators.ts: imports the transport module '${spec}', so it can open a socket or start a process`,
      ])
      expect(libGraphViolations(virtualLibs({ 'pinned-fetch.ts': text }), ['pinned-fetch.ts']), spec).toEqual([])
    }
  })

  it('flags a transport module reached through the lib modules a lib module imports', () => {
    const direct = {
      'auth.ts': "import { x } from './b'\nexport const y = x",
      'b.ts': "import { request } from 'undici'\nexport const x = request",
    }
    expect(libGraphViolations(virtualLibs(direct), ['auth.ts'])).toEqual([
      "b.ts: imports the transport module 'undici', so it can open a socket or start a process",
    ])
    const deep = {
      'auth.ts': "import { x } from './gate/index'\nexport const y = x",
      'gate/index.ts': "export { x } from '../b.js'",
      'b.ts': "export { Agent } from 'node:https'",
    }
    expect(libGraphViolations(virtualLibs(deep), ['auth.ts'])).toEqual([
      "b.ts: imports the transport module 'node:https', so it can open a socket or start a process",
    ])
    const clean = {
      'auth.ts': "import { x } from './b'\nexport const y = x",
      'b.ts': "import { hash } from 'bcryptjs'\nexport const x = hash",
    }
    expect(libGraphViolations(virtualLibs(clean), ['auth.ts'])).toEqual([])
  })

  it('reads a type-only import and a type annotation in a lib module as no use at all', () => {
    const erased = {
      'agent-registry.ts':
        "import type WebSocket from 'ws'\nimport type { S } from './schemas.js'\nexport const s: S = 1\nexport function use(ws: WebSocket | null) { return ws === null }",
      'schemas.ts': 'export type S = number',
    }
    expect(libGraphViolations(virtualLibs(erased), ['agent-registry.ts'])).toEqual([])
    const mixed = {
      'agent-registry.ts':
        "import type WebSocket from 'ws'\nexport const s = 1\nexport function use(ws: WebSocket | null) { return ws === null }\nimport { connect } from 'net'\nexport const c = connect",
    }
    expect(libGraphViolations(virtualLibs(mixed), ['agent-registry.ts'])).toEqual([
      "agent-registry.ts: imports the transport module 'net', so it can open a socket or start a process",
    ])
  })

  it('flags a lib module that loads a module by a computed name, or uses a native binding, a global client or a raw fetch', () => {
    const cases: Array<[string, string]> = [
      ["import { createRequire } from 'node:module'\nexport const r = createRequire", 'createRequire'],
      ["export const t = process.binding('tcp_wrap')", 'process.binding'],
      ["export const ws = new WebSocket('wss://x')", 'global WebSocket'],
      ["export const es = new EventSource('https://x')", 'global WebSocket, EventSource or XMLHttpRequest client'],
      ["export const r = new XMLHttpRequest()", 'global WebSocket, EventSource or XMLHttpRequest client'],
      ['export const get = (u: string) => fetch(u)', 'fetch'],
    ]
    for (const [text, expected] of cases) {
      const offences = libGraphViolations(virtualLibs({ 'data-store.ts': text }), ['data-store.ts'])
      expect(offences.length, text).toBe(1)
      expect(offences[0], text).toContain('data-store.ts')
      expect(offences[0], text).toContain(expected)
    }
    expect(libGraphViolations(virtualLibs({ 'a.ts': 'const m = await import(name)\nexport { m }' }), ['a.ts'])).toEqual([
      expect.stringContaining('computed import()'),
    ])
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
    const offenders = routes.flatMap((r) => routeImportViolations(r.text, r.rel).map((v) => `${r.rel}: ${v}`))
    expect(offenders).toEqual([])
  })

  it('has no route that loads child_process except the per-file listed ones', () => {
    const offenders = routes
      .filter((r) => /\bchild_process\b/.test(stripComments(r.text)) && !(r.rel in ROUTES_ALLOWED_CHILD_PROCESS))
      .map((r) => r.rel)
    expect(offenders).toEqual([])
    for (const rel of Object.keys(ROUTES_ALLOWED_CHILD_PROCESS)) {
      const route = routes.find((r) => r.rel === rel)
      expect(route, `route ${rel} of ROUTES_ALLOWED_CHILD_PROCESS must exist`).toBeTruthy()
      expect(route!.text, `${rel} must still be a route that runs a local process`).toMatch(/\bchild_process\b/)
    }
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

  it('resolves every allowlisted @/lib module to a file, so the lib scan has something to read', () => {
    expect(allowedLibSpecs.length).toBeGreaterThan(3)
    expect(unresolvedAllowedLibs).toEqual([])
    const found = Object.keys(reachableLibSources)
    for (const rel of ['gateway.ts', 'pinned-fetch.ts', 'agent-registry.ts', 'auth.ts']) {
      expect(found, `src/lib/${rel} must be reachable from a route`).toContain(rel)
    }
    expect(found.length).toBeGreaterThan(5)
  })

  it('has no module reachable from a route that opens a socket or starts a process of its own', () => {
    const offenders = libGraphViolations(readLib, reachableLibFiles)
    expect(offenders).toEqual([])
  })

  it('trusts only transport files that are reachable and really hold the capability', () => {
    const trusted = Object.keys(TRUSTED_TRANSPORT_LIBS)
    expect(trusted.length).toBeGreaterThan(0)
    for (const rel of trusted) {
      expect(Object.keys(reachableLibSources), `src/lib/${rel} must be reachable from a route`).toContain(rel)
      expect(libFileViolations(rel, reachableLibSources[rel]).length, `src/lib/${rel} must need its trust`).toBeGreaterThan(0)
    }
  })
})
