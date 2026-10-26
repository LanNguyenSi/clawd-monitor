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
 * - The `@/` modules a route may import are scanned too. Every `@/` entry of
 *   ALLOWED_ROUTE_IMPORTS (including `@/types`) is a root of a walk over all of
 *   `src`: a specifier is resolved as `@/*` -> `src/*` or relative to the
 *   importing file, over the candidates `.ts .tsx .js .jsx .mjs .cjs` and
 *   `index.*` (tsconfig has `allowJs: true`), and the walk follows the runtime
 *   imports it finds. It fails open on nothing: a relative or `@/` specifier
 *   that does not resolve to a file under `src` is an offence naming the file
 *   and the specifier, so a path that leaves `src` (`../server/evil`), an alias
 *   to a directory that is not there (`@/server/evil`) or a broken `.js` require
 *   is refused, not silently dropped.
 * - A reachable file that is not the trusted transport layer may import, as a
 *   bare module, only what is on REACHABLE_ALLOWED_MODULES; anything else is an
 *   offence, so a client nobody thought of (axios, node:dns) is refused too. A
 *   transport module is named as such in its message. A reachable file may also
 *   not call fetch itself, use a global client, or load by a computed name or a
 *   native binding. TypeScript erases an `import type` statement, so it is not
 *   a use and loads nothing.
 * - The files that are the guarded transport layer, or that legitimately name a
 *   client type, are in TRUSTED_REACHABLE_LIBS, mapped to the offence KINDS they
 *   may have (`gateway.ts`: the operator default fetch only; `pinned-fetch.ts`:
 *   net, undici, dns, the fetch; `agent-registry.ts`: a global-client type
 *   annotation). A trusted file is excused only for the kinds it declares, so a
 *   new capability there (child_process in gateway.ts) is still an offence, and
 *   every declared kind is asserted to still be present, so a stale trust entry
 *   fails too.
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
 * Whether `key` is an entry of one of the lists below. Every lookup goes through
 * this own-key check, never `in` or a bare index: a plain object inherits
 * `constructor`, `toString` and `__proto__`, which would otherwise be on every
 * list.
 */
function hasEntry(map: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(map, key)
}

/**
 * Modules a route under src/app/api may import: the ones the routes import
 * today. None of them is an HTTP or socket client, and the `@/` modules are
 * scanned themselves for a client of their own (see TRUSTED_REACHABLE_LIBS).
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
    if (hasEntry(ALLOWED_ROUTE_IMPORTS, name)) continue
    if (name === 'child_process' && rel !== null && hasEntry(ROUTES_ALLOWED_CHILD_PROCESS, rel)) continue
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

/** The walk root: `@/*` maps to `src/*`, and every path a file lives at is relative to `src`. */
const SRC_ROOT = join(__dirname, '..', '..', 'src')

/**
 * Bare modules that open a socket, speak a protocol or start a process, with or
 * without the `node:` prefix. They are never on REACHABLE_ALLOWED_MODULES, so a
 * reachable file that imports one is refused; this list is kept for the offence
 * message, so the failure names the transport rather than just "not allowed".
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
 * The bare modules a reachable file (that is not a trusted transport file) may
 * import: the non-transport runtime dependencies the reachable files import
 * today. This is an allowlist, so a module the layer does not use yet (axios,
 * node:dns) is refused until it is added here with a reason. Transport modules
 * are never added: they are what the transport layer owns, and they stay an
 * offence. Every entry must be in use by a reachable file (checked in the
 * real-tree tests), so the list cannot keep a permission nobody needs.
 */
const REACHABLE_ALLOWED_MODULES: Record<string, string> = {
  jsonwebtoken: 'signs and verifies the dashboard session cookie (auth.ts)',
  fs: 'reads and writes the local JSON stores (data-store.ts)',
  path: 'joins paths inside the local data directory (data-store.ts)',
}

/**
 * The offence kind of a bare module import: `module:<name>`, without `node:`.
 * The other kinds (`raw-fetch`, `global-client`, `global-client-type`,
 * `computed`, `create-require`, `unresolved`) have no `module:` prefix, so a
 * package named like one of them (`raw-fetch`) is never excused as that kind.
 */
function moduleKind(name: string): string {
  return `module:${name}`
}

/**
 * Reachable files that are allowed to hold a transport capability, mapped to the
 * offence KINDS they may have. These are the guarded transport layer and the one
 * file that legitimately names a client type; adding one is a read-the-file
 * decision, never a way to silence a failure. A trusted file is excused only for
 * the kinds it lists, and each listed kind is asserted to still be present (in
 * the real-tree test), so a stale trust entry that no longer matches the file
 * fails too.
 */
const TRUSTED_REACHABLE_LIBS: Record<string, readonly string[]> = {
  // The gateway URL policy plus the operator default fetch, the boundary the other rules point at.
  'lib/gateway.ts': ['raw-fetch'],
  // The DNS-pinned undici transport: it opens the socket on purpose, after the URL policy has run.
  'lib/pinned-fetch.ts': [moduleKind('net'), moduleKind('undici'), moduleKind('dns'), 'raw-fetch'],
  // Names the agent's socket only as a type (ws: WebSocket); TypeScript erases it, but it is a use this scan reports.
  'lib/agent-registry.ts': ['global-client-type'],
}

/**
 * A real `import type ... from '...'` / `export type ... from '...'` statement.
 * TypeScript erases it, so it neither loads a module nor constructs a client.
 * The match is a single, bounded import head (`{ ... }`, `* as name`, or a bare
 * name) immediately followed by its own `from '...'`; it never reaches across a
 * newline to a later `from`, so a type ALIAS (`export type N = number`) is not a
 * match and can never swallow the value import or re-export that follows it.
 * `import { type X } from 'ws'` is not treated as type-only (the whole statement
 * is only erased when every binding is a type, which is not worth reasoning
 * about in a text scan).
 */
function stripTypeOnlyImports(code: string): string {
  return code.replace(
    /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s*(['"`])[^'"`]*\1/g,
    '',
  )
}

/**
 * Whether a lib file uses a global client as a value, and how, or null if it
 * does not name one at all. Only an unambiguous type position is not a use: a
 * `name: X` / `name?: X` annotation (the token right after a `:`), and a generic
 * argument (`Array<WebSocket>`, `<K, WebSocket>`, the token right after a `<` or
 * after a comma inside an open `<`). Everything else — `new WebSocket(...)`,
 * `const w = WebSocket`, an object-literal value `{ c: WebSocket }`, a ternary
 * `cond ? a : WebSocket` — is a real client. A value use is kind
 * `global-client`; a purely-annotational one is the weaker kind
 * `global-client-type` (a client type behind a route, still reported, but the
 * one kind the type-naming lib is trusted for). `ws: WebSocket` and
 * `Array<WebSocket>` read as a type; the scan does not try to tell an interface
 * body from an object literal, so a `{ c: WebSocket }` is reported too and only
 * a vetted file is trusted for it.
 */
function globalClientUse(code: string): 'global-client' | 'global-client-type' | null {
  const re = /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/g
  let m: RegExpExecArray | null
  let seen = false
  while ((m = re.exec(code)) !== null) {
    seen = true
    const before = code.slice(0, m.index).replace(/\s+$/, '')
    const annotation = /[:<]$/.test(before) || (/,[\w$.\s|&]*$/.test(before) && before.lastIndexOf('<') > before.lastIndexOf('>'))
    if (!annotation) return 'global-client'
  }
  return seen ? 'global-client-type' : null
}

/** The runtime module specifiers of a lib file (type-only imports erased). */
function moduleImportSpecifiers(text: string): string[] {
  return importedSpecifiers(stripTypeOnlyImports(stripComments(text))).specs
}

/** A file under `src` resolved from a specifier, an error for a broken path, or null for a bare module. */
type ResolvedModule = string | { error: string } | null

/** The candidate file paths a stem could name, mirroring the `@/*` alias and the `.js`-to-source rewrite. */
function moduleCandidates(stem: string): string[] {
  const base = stem.replace(/\.(?:js|jsx|mjs|cjs)$/, '')
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
  return [...exts.map((e) => base + e), ...exts.map((e) => `${base}/index${e}`)]
}

/**
 * Where a specifier points, as a path under `src`. `@/*` maps to `src/*`; a
 * relative specifier is resolved from the importing file. A package or Node
 * built-in is null (checked by REACHABLE_ALLOWED_MODULES instead). A relative or
 * `@/` specifier that names no file under `src` is an error, not a silent drop:
 * it must not become a way to reach code outside the scan.
 */
function resolveModule(read: (rel: string) => string | null, fromRel: string, spec: string): ResolvedModule {
  let stem: string | null = null
  if (spec.startsWith('@/')) stem = spec.slice(2)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const joined = posix.normalize(posix.join(posix.dirname(fromRel), spec))
    if (joined === '..' || joined.startsWith('../')) return { error: 'resolves to a path above src' }
    stem = joined
  }
  if (stem === null) return null
  const found = moduleCandidates(stem).find((c) => read(c) !== null)
  if (found !== undefined) return found
  return { error: 'does not resolve to a file under src' }
}

/** An offence of a reachable file: an offence kind (for the trust filter) and its message. */
type Violation = { kind: string; text: string }

/**
 * What one reachable file does that a module behind a route must not do: a
 * relative or `@/` specifier that resolves to no file under src, a bare module
 * that is not on REACHABLE_ALLOWED_MODULES, a computed name or a native binding,
 * a raw fetch, or a global client. The type-only imports are erased first; an
 * internal import is followed by the walk, not reported here.
 */
function moduleFileViolations(read: (rel: string) => string | null, rel: string, text: string): Violation[] {
  const code = stripTypeOnlyImports(stripComments(text))
  const { specs, computed } = importedSpecifiers(code)
  const out: Violation[] = []
  const add = (kind: string, desc: string) => out.push({ kind, text: `${rel}: ${desc}` })
  for (let i = 0; i < computed; i++) add('computed', 'a computed import() or require() specifier')
  for (const spec of specs) {
    const resolved = resolveModule(read, rel, spec)
    if (resolved === null) {
      const name = spec.replace(/^node:/, '')
      if (hasEntry(REACHABLE_ALLOWED_MODULES, name)) continue
      if (TRANSPORT_MODULES.includes(name)) {
        add(moduleKind(name), `imports the transport module '${spec}', so it can open a socket or start a process`)
      } else {
        add(moduleKind(name), `imports '${spec}', which is not on REACHABLE_ALLOWED_MODULES`)
      }
    } else if (typeof resolved === 'object') {
      add('unresolved', `import of '${spec}' ${resolved.error}`)
    }
  }
  if (/\bcreateRequire\b|\bprocess\s*\.\s*(?:binding|dlopen)\b/.test(code)) {
    add('create-require', 'createRequire or process.binding (loads a module or a native client without a visible specifier)')
  }
  const client = globalClientUse(code)
  if (client === 'global-client') add(client, 'a global WebSocket, EventSource or XMLHttpRequest client')
  else if (client === 'global-client-type') add(client, 'a WebSocket, EventSource or XMLHttpRequest type annotation (a client type behind a route)')
  if (usesRawFetch(code)) add('raw-fetch', 'calls fetch or pinnedFetch itself instead of going through the gateway helpers')
  return out
}

/** Every file under src reachable from `rootFiles` through runtime `@/` and relative imports. */
function collectReachableModules(read: (rel: string) => string | null, rootFiles: string[]): Record<string, string> {
  const found: Record<string, string> = {}
  const queue = [...rootFiles]
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (hasEntry(found, rel)) continue
    const text = read(rel)
    if (text === null) continue
    found[rel] = text
    for (const spec of moduleImportSpecifiers(text)) {
      const next = resolveModule(read, rel, spec)
      if (typeof next === 'string') queue.push(next)
    }
  }
  return found
}

/**
 * Offences of a reachable module graph. A trusted file is excused only for the
 * kinds it declares; every other violation, and every violation of an
 * untrusted file, is reported.
 */
function graphViolations(read: (rel: string) => string | null, rootFiles: string[]): string[] {
  return Object.entries(collectReachableModules(read, rootFiles)).flatMap(([rel, text]) => {
    const violations = moduleFileViolations(read, rel, text)
    const kinds = hasEntry(TRUSTED_REACHABLE_LIBS, rel) ? TRUSTED_REACHABLE_LIBS[rel] : []
    return violations.filter((v) => !kinds.includes(v.kind)).map((v) => v.text)
  })
}

/** Reads a file by its path under src; null when there is no such file. */
function readSrc(rel: string): string | null {
  try {
    return readFileSync(join(SRC_ROOT, rel), 'utf8')
  } catch {
    return null
  }
}

/** The same reader over an in-memory fixture tree, for the sample tests. */
function virtualLibs(files: Record<string, string>): (rel: string) => string | null {
  return (rel: string) => (hasEntry(files, rel) ? files[rel] : null)
}

const allowedAliasSpecs = Object.keys(ALLOWED_ROUTE_IMPORTS).filter((name) => name.startsWith('@/'))
const allowedAliasFiles = allowedAliasSpecs.map((spec) => ({ spec, resolved: resolveModule(readSrc, '', spec) }))
const unresolvedAllowedAlias = allowedAliasFiles.filter((e) => typeof e.resolved !== 'string').map((e) => e.spec)
const reachableFiles = allowedAliasFiles
  .map((e) => e.resolved)
  .filter((r): r is string => typeof r === 'string')
const reachableSources = collectReachableModules(readSrc, reachableFiles)

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

  it('flags a lib module that loads a transport module, and excuses a trusted file only for the kinds it declares', () => {
    for (const spec of ['node:net', 'tls', 'http', 'https', 'http2', 'node:dgram', 'child_process', 'undici', 'ws']) {
      const text = `import c from '${spec}'\nexport const x = c`
      expect(graphViolations(virtualLibs({ 'input-validators.ts': text }), ['input-validators.ts']), spec).toEqual([
        `input-validators.ts: imports the transport module '${spec}', so it can open a socket or start a process`,
      ])
    }
    // pinned-fetch.ts is trusted for net, undici, dns and the fetch — not for anything else.
    const pinned = (spec: string) => graphViolations(virtualLibs({ 'lib/pinned-fetch.ts': `import c from '${spec}'` }), ['lib/pinned-fetch.ts'])
    expect(pinned('node:net')).toEqual([])
    expect(pinned('undici')).toEqual([])
    expect(pinned('node:dns')).toEqual([])
    expect(pinned('tls')).toEqual(["lib/pinned-fetch.ts: imports the transport module 'tls', so it can open a socket or start a process"])
    expect(pinned('child_process')).toEqual(["lib/pinned-fetch.ts: imports the transport module 'child_process', so it can open a socket or start a process"])
  })

  it('flags a transport module reached through the lib modules a lib module imports', () => {
    const direct = {
      'auth.ts': "import { x } from './b'\nexport const y = x",
      'b.ts': "import { request } from 'undici'\nexport const x = request",
    }
    expect(graphViolations(virtualLibs(direct), ['auth.ts'])).toEqual([
      "b.ts: imports the transport module 'undici', so it can open a socket or start a process",
    ])
    const deep = {
      'auth.ts': "import { x } from './gate/index'\nexport const y = x",
      'gate/index.ts': "export { x } from '../b.js'",
      'b.ts': "export { Agent } from 'node:https'",
    }
    expect(graphViolations(virtualLibs(deep), ['auth.ts'])).toEqual([
      "b.ts: imports the transport module 'node:https', so it can open a socket or start a process",
    ])
    const clean = {
      'auth.ts': "import { x } from './b'\nexport const y = x",
      'b.ts': "import { join } from 'path'\nexport const x = join",
    }
    expect(graphViolations(virtualLibs(clean), ['auth.ts'])).toEqual([])
  })

  it('erases a type-only import, but reports a global-client type annotation unless the file is trusted for it', () => {
    // An `import type` from a transport module is erased (TypeScript loads nothing), and X is not a client.
    expect(graphViolations(virtualLibs({ 'foo.ts': "import type { X } from 'ws'\nexport const x = 1 as X" }), ['foo.ts'])).toEqual([])
    // A `ws: WebSocket` annotation is a use this scan reports, but it is the only kind lib/agent-registry.ts is trusted for.
    const wsType = 'export function use(ws: WebSocket | null) { return ws === null }'
    expect(graphViolations(virtualLibs({ 'agent-registry.ts': wsType }), ['agent-registry.ts'])).toEqual([
      'agent-registry.ts: a WebSocket, EventSource or XMLHttpRequest type annotation (a client type behind a route)',
    ])
    expect(graphViolations(virtualLibs({ 'lib/agent-registry.ts': wsType }), ['lib/agent-registry.ts'])).toEqual([])
    // A type import plus the annotation is clean in the trusted file, and the relative `import type` is not followed:
    // schemas.ts imports a module that is on no list, so following it would be an offence.
    const erased = {
      'lib/agent-registry.ts':
        "import type WebSocket from 'ws'\nimport type { S } from './schemas.js'\nexport const s: S = 1\nexport function use(ws: WebSocket | null) { return ws === null }",
      'lib/schemas.ts': "import { z } from 'zod'\nexport const schema = z",
    }
    expect(graphViolations(virtualLibs(erased), ['lib/agent-registry.ts'])).toEqual([])
    expect(Object.keys(collectReachableModules(virtualLibs(erased), ['lib/agent-registry.ts']))).toEqual(['lib/agent-registry.ts'])
    // The same type import and annotation do not hide a value `net` import that follows them.
    const mixed = {
      'lib/agent-registry.ts':
        "import type WebSocket from 'ws'\nexport const s = 1\nexport function use(ws: WebSocket | null) { return ws === null }\nimport { connect } from 'net'\nexport const c = connect",
    }
    expect(graphViolations(virtualLibs(mixed), ['lib/agent-registry.ts'])).toEqual([
      "lib/agent-registry.ts: imports the transport module 'net', so it can open a socket or start a process",
    ])
  })

  it('strips a type-only import only up to the end of its own import head, so it cannot swallow the next statement', () => {
    // `export type { A }` re-exports a local type and has no `from`: the strip must not run on to the next `from`.
    const flagged: Array<[string, string]> = [
      ["export type { A }\nimport { spawn } from 'child_process'\nexport const s = spawn", 'child_process'],
      ["export type { A }\nexport { connect } from 'net'", 'net'],
    ]
    for (const [text, spec] of flagged) {
      expect(graphViolations(virtualLibs({ 'lib/data-store.ts': text }), ['lib/data-store.ts']), text).toEqual([
        `lib/data-store.ts: imports the transport module '${spec}', so it can open a socket or start a process`,
      ])
    }
    // Controls: each import head form is still erased (a default name, and a namespace).
    for (const text of ["import type WebSocket from 'ws'", "import type * as ns from 'ws'"]) {
      expect(graphViolations(virtualLibs({ 'lib/data-store.ts': text }), ['lib/data-store.ts']), text).toEqual([])
    }
  })

  it('does not let a type alias swallow the value import or re-export that follows it', () => {
    const flagged: Array<[string, string]> = [
      ["export type N = number\nexport { spawn } from 'child_process'", 'child_process'],
      ["export type N = number\nimport { connect } from 'net'", 'net'],
      ["export type Handler = (n: number) => void\nexport { spawn } from 'node:child_process'", 'node:child_process'],
    ]
    for (const [text, spec] of flagged) {
      const offences = graphViolations(virtualLibs({ 'input-validators.ts': text }), ['input-validators.ts'])
      expect(offences.length, text).toBe(1)
      expect(offences[0], text).toContain(`transport module '${spec}'`)
    }
    // Controls: a real type-only import, and a type alias that does NOT swallow the following import.
    expect(graphViolations(virtualLibs({ 'input-validators.ts': "import type { X } from 'ws'" }), ['input-validators.ts'])).toEqual([])
    expect(graphViolations(virtualLibs({ 'input-validators.ts': "export type Y = number\nexport type X = Y\nimport { join } from 'path'" }), ['input-validators.ts'])).toEqual([])
  })

  it('refuses a relative or @/ specifier that does not resolve to a file under src', () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ 'lib/a.ts': "import { x } from '../server/evil'\nexport const y = x" }, '../server/evil'],
      [{ 'lib/a.ts': "import { x } from '@/server/evil'\nexport const y = x" }, '@/server/evil'],
      [{ 'lib/a.ts': "const m = require('./evil.js')\nexport const y = m" }, './evil.js'],
    ]
    for (const [files, spec] of cases) {
      const offences = graphViolations(virtualLibs(files), ['lib/a.ts'])
      expect(offences.length, spec).toBe(1)
      expect(offences[0], spec).toContain(spec)
      expect(offences[0], spec).toContain('does not resolve')
    }
    // Widening the walk to all of src also follows a runtime import into a .js file and scans it.
    expect(
      graphViolations(virtualLibs({ 'lib/a.ts': "import { x } from './b.js'\nexport const y = x", 'lib/b.js': "import { request } from 'undici'\nexport const x = request" }), ['lib/a.ts']),
    ).toEqual(["lib/b.js: imports the transport module 'undici', so it can open a socket or start a process"])
  })

  it('scans every @/ allowlist root, including @/types', () => {
    expect(resolveModule(readSrc, '', '@/types')).toBe('types/index.ts')
    expect(
      graphViolations(virtualLibs({ 'types/index.ts': "import { spawn } from 'child_process'\nexport const s = spawn" }), ['types/index.ts']),
    ).toEqual(["types/index.ts: imports the transport module 'child_process', so it can open a socket or start a process"])
  })

  it('allows a reachable module only the bare modules on REACHABLE_ALLOWED_MODULES', () => {
    for (const [text, spec] of [["import axios from 'axios'", 'axios'], ["import dns from 'node:dns'", 'node:dns']] as const) {
      const offences = graphViolations(virtualLibs({ 'data-store.ts': text }), ['data-store.ts'])
      expect(offences.length, text).toBe(1)
      expect(offences[0], text).toContain(spec)
      expect(offences[0], text).toContain('REACHABLE_ALLOWED_MODULES')
    }
    expect(graphViolations(virtualLibs({ 'data-store.ts': "import jwt from 'jsonwebtoken'\nexport const j = jwt" }), ['data-store.ts'])).toEqual([])
  })

  it('excuses a trusted transport file only for its kinds, so child_process in gateway.ts is an offence', () => {
    expect(graphViolations(virtualLibs({ 'lib/gateway.ts': "import { exec } from 'child_process'\nexport const run = exec" }), ['lib/gateway.ts'])).toEqual([
      "lib/gateway.ts: imports the transport module 'child_process', so it can open a socket or start a process",
    ])
    // gateway.ts is trusted for the operator default fetch, which is present but is not an offence when it is its only kind.
    expect(graphViolations(virtualLibs({ 'lib/gateway.ts': 'export function r(u: string) { return fetch(u) }' }), ['lib/gateway.ts'])).toEqual([])
  })

  it('keeps module kinds apart from the other offence kinds, so a package named like a trusted kind is not excused', () => {
    // gateway.ts is trusted for 'raw-fetch'; a package of that name is kind 'module:raw-fetch', which it is not trusted for.
    expect(graphViolations(virtualLibs({ 'lib/gateway.ts': "import f from 'raw-fetch'\nexport const g = f" }), ['lib/gateway.ts'])).toEqual([
      "lib/gateway.ts: imports 'raw-fetch', which is not on REACHABLE_ALLOWED_MODULES",
    ])
    expect(graphViolations(virtualLibs({ 'lib/agent-registry.ts': "import c from 'global-client-type'\nexport const g = c" }), ['lib/agent-registry.ts'])).toEqual([
      "lib/agent-registry.ts: imports 'global-client-type', which is not on REACHABLE_ALLOWED_MODULES",
    ])
    expect(moduleFileViolations(virtualLibs({}), 'lib/a.ts', "import { connect } from 'node:net'").map((v) => v.kind)).toEqual(['module:net'])
  })

  it('looks entries up by own key, so constructor, toString or __proto__ is on no list', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(routeImportViolations(`import x from '${name}'`), name).toEqual([`import of '${name}', which is not on ALLOWED_ROUTE_IMPORTS`])
      expect(graphViolations(virtualLibs({ 'lib/data-store.ts': `import x from '${name}'\nexport const y = x` }), ['lib/data-store.ts']), name).toEqual([
        `lib/data-store.ts: imports '${name}', which is not on REACHABLE_ALLOWED_MODULES`,
      ])
      expect(virtualLibs({})(name), name).toBeNull()
    }
    // A route path that names an inherited key is not on the per-file child_process list.
    expect(routeImportViolations("import { spawn } from 'child_process'", 'constructor')).toEqual([
      "import of 'child_process', and child_process is allowed only for the routes in ROUTES_ALLOWED_CHILD_PROCESS",
    ])
    // A file whose path names an inherited key is not trusted for anything.
    expect(graphViolations(virtualLibs({ toString: "import { request } from 'undici'\nexport const r = request" }), ['toString'])).toEqual([
      "toString: imports the transport module 'undici', so it can open a socket or start a process",
    ])
  })

  it('flags an object-literal or ternary use of a global client that a bare colon strip would hide', () => {
    for (const text of ['export const x = { c: WebSocket }', 'export const x = (cond ? a : WebSocket)']) {
      const offences = graphViolations(virtualLibs({ 'a.ts': text }), ['a.ts'])
      expect(offences.length, text).toBe(1)
      expect(offences[0], text).toContain('WebSocket')
    }
  })

  it('flags a lib module that loads a module by a computed name, or uses a native binding, a global client or a raw fetch', () => {
    const cases: Array<[string, string]> = [
      ['export const r = createRequire(import.meta.url)', 'createRequire'],
      ["export const t = process.binding('tcp_wrap')", 'process.binding'],
      ["export const ws = new WebSocket('wss://x')", 'global WebSocket'],
      ["export const es = new EventSource('https://x')", 'global WebSocket, EventSource or XMLHttpRequest client'],
      ['export const r = new XMLHttpRequest()', 'global WebSocket, EventSource or XMLHttpRequest client'],
      ['export const get = (u: string) => fetch(u)', 'fetch'],
    ]
    for (const [text, expected] of cases) {
      const offences = graphViolations(virtualLibs({ 'data-store.ts': text }), ['data-store.ts'])
      expect(offences.length, text).toBe(1)
      expect(offences[0], text).toContain('data-store.ts')
      expect(offences[0], text).toContain(expected)
    }
    expect(graphViolations(virtualLibs({ 'a.ts': 'const m = await import(name)\nexport { m }' }), ['a.ts'])).toEqual([
      expect.stringContaining('computed import()'),
    ])
  })

  it('stops the walk on a cycle (the visited check), reporting the transport module once', { timeout: 3000 }, () => {
    const files = {
      'lib/a.ts': "import { x } from './b'\nexport const y = x",
      'lib/b.ts': "import { request } from 'undici'\nexport { a } from './a'\nexport const r = request",
    }
    expect(graphViolations(virtualLibs(files), ['lib/a.ts'])).toEqual([
      "lib/b.ts: imports the transport module 'undici', so it can open a socket or start a process",
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
    const offenders = routes.filter((r) => !hasEntry(NON_GATEWAY_FETCH, r.rel) && usesRawFetch(r.text)).map((r) => r.rel)
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
      .filter((r) => /\bchild_process\b/.test(stripComments(r.text)) && !hasEntry(ROUTES_ALLOWED_CHILD_PROCESS, r.rel))
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

  it('resolves every allowlisted @/ module to a file, including @/types, so the walk has roots', () => {
    expect(allowedAliasSpecs.length).toBeGreaterThan(4)
    expect(unresolvedAllowedAlias).toEqual([])
    const found = Object.keys(reachableSources)
    for (const rel of ['lib/gateway.ts', 'lib/pinned-fetch.ts', 'lib/agent-registry.ts', 'lib/auth.ts', 'types/index.ts']) {
      expect(found, `src/${rel} must be reachable from a route`).toContain(rel)
    }
    expect(found.length).toBeGreaterThan(5)
  })

  it('has no module reachable from a route that opens a socket or starts a process of its own', () => {
    const offenders = graphViolations(readSrc, reachableFiles)
    expect(offenders).toEqual([])
  })

  it('keeps every REACHABLE_ALLOWED_MODULES entry in use by a reachable file', () => {
    const used = new Set(
      Object.entries(reachableSources).flatMap(([rel, text]) =>
        moduleImportSpecifiers(text)
          .filter((spec) => resolveModule(readSrc, rel, spec) === null)
          .map((spec) => spec.replace(/^node:/, '')),
      ),
    )
    expect(Object.keys(REACHABLE_ALLOWED_MODULES).filter((name) => !used.has(name))).toEqual([])
  })

  it('trusts a reachable file only for the capability kinds it declares, and needs them all', () => {
    const trusted = Object.keys(TRUSTED_REACHABLE_LIBS)
    expect(trusted.length).toBeGreaterThan(0)
    for (const rel of trusted) {
      expect(Object.keys(reachableSources), `src/${rel} must be reachable from a route`).toContain(rel)
      const kinds = new Set(moduleFileViolations(readSrc, rel, reachableSources[rel]).map((v) => v.kind))
      for (const kind of TRUSTED_REACHABLE_LIBS[rel]) {
        expect(kinds.has(kind), `src/${rel} must still hold its trusted '${kind}' capability (stale trust entry)`).toBe(true)
      }
    }
  })
})
