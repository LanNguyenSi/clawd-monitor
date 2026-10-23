/**
 * Gateway API client, proxies requests to the default OpenClaw gateway (or an allowlisted override).
 * Used server-side in API routes.
 */
import { GatewayUrlError, isPrivateHost } from './gateway-policy'
import { pinnedFetch } from './pinned-fetch'

const DEFAULT_GATEWAY_URL = process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL ?? 'http://localhost:9500'
const DEFAULT_GATEWAY_TOKEN = process.env.DEFAULT_GATEWAY_TOKEN ?? ''

/**
 * One ALLOWED_GATEWAY_HOSTS entry: a lower-case host name or IP literal
 * (IPv6 in brackets), optionally followed by `:port`. An entry without a port
 * allows only the default https port (443); an entry with a port allows only
 * that port. An entry whose port is not 1-65535 is dropped (fail closed).
 */
interface AllowedHost {
  host: string
  port: number
}

const DEFAULT_HTTPS_PORT = 443

function parseAllowedHost(entry: string): AllowedHost | null {
  let host: string
  let portText: string | undefined
  const bracketed = entry.match(/^(\[[^\]]*\])(?::(.*))?$/)
  if (bracketed) {
    host = bracketed[1]
    portText = bracketed[2]
  } else {
    // An unbracketed IPv6 literal ends up with a "port" that is not a number
    // and is dropped below, as it could never equal a URL host name anyway.
    const colon = entry.indexOf(':')
    host = colon === -1 ? entry : entry.slice(0, colon)
    portText = colon === -1 ? undefined : entry.slice(colon + 1)
  }
  if (portText === undefined) return { host, port: DEFAULT_HTTPS_PORT }
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number(portText)
  return port >= 1 && port <= 65535 ? { host, port } : null
}

// Hosts that callers may target via the `x-gateway-url` header, beyond the
// operator-configured default. Comma-separated, case-insensitive host names,
// each optionally with a port (see AllowedHost).
const ALLOWED_GATEWAY_HOSTS: AllowedHost[] = (process.env.ALLOWED_GATEWAY_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
  .map(parseAllowedHost)
  .filter((h): h is AllowedHost => h !== null)

// The policy pieces live in gateway-policy.ts so the pinned-address fetch
// shares them; re-exported here because this is where callers import them.
export { GatewayUrlError, isPrivateHost }

export interface AssertGatewayUrlOptions {
  /**
   * Whether a URL equal to the operator-configured default gateway skips the
   * https/allowlist/port/private-range checks. Required, so a caller has to
   * decide: pass false for a URL that a remote party chose (for example the
   * one an agent reports at its handshake), which must meet the full rule even
   * when it equals the default. Prefer assertRemoteGatewayUrl for that case.
   */
  trustDefault: boolean
}

interface GatewayUrlCheck {
  url: URL
  /** True when the URL is the operator default and was waved through. */
  trusted: boolean
}

function checkGatewayUrl(rawUrl: string, options: AssertGatewayUrlOptions): GatewayUrlCheck {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new GatewayUrlError('Invalid gateway URL')
  }

  // Trust the operator-configured default verbatim, unless the caller says the
  // URL came from a remote party.
  if (options.trustDefault && rawUrl === DEFAULT_GATEWAY_URL) return { url: parsed, trusted: true }

  if (parsed.protocol !== 'https:') {
    throw new GatewayUrlError('Gateway URL must use https')
  }
  const hostname = parsed.hostname.toLowerCase()
  const entries = ALLOWED_GATEWAY_HOSTS.filter((e) => e.host === hostname)
  if (entries.length === 0) {
    throw new GatewayUrlError('Gateway host not allowed')
  }
  if (isPrivateHost(hostname)) {
    throw new GatewayUrlError('Gateway host not allowed')
  }
  const port = parsed.port === '' ? DEFAULT_HTTPS_PORT : Number(parsed.port)
  if (!entries.some((e) => e.port === port)) {
    throw new GatewayUrlError('Gateway port not allowed')
  }
  return { url: parsed, trusted: false }
}

/**
 * Validate a resolved gateway URL against SSRF abuse before it is fetched.
 *
 * With `trustDefault: true` the operator-configured default is trusted (it may
 * legitimately be http/loopback). Any other URL must be https, present in the
 * ALLOWED_GATEWAY_HOSTS allowlist with a matching port, and not point at a
 * private/loopback range. This checks the URL text only: a host name that
 * resolves to a private address is stopped when the request connects (see
 * gatewayFetch and remoteGatewayFetch).
 *
 * @throws {GatewayUrlError} if the URL is not permitted.
 */
export function assertGatewayUrlAllowed(rawUrl: string, options: AssertGatewayUrlOptions): URL {
  return checkGatewayUrl(rawUrl, options).url
}

/**
 * Validate a gateway URL that a remote party chose (the one an agent reports
 * at its handshake). The operator default gets no exception.
 *
 * @throws {GatewayUrlError} if the URL is not permitted.
 */
export function assertRemoteGatewayUrl(rawUrl: string): URL {
  return checkGatewayUrl(rawUrl, { trustDefault: false }).url
}

interface GatewayRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/**
 * Check `base`, then fetch `base + path`. The trusted operator default goes
 * through the global fetch; every other URL goes through pinnedFetch, which
 * resolves the host once, rejects non-public answers and connects to the
 * checked address. Redirects are never followed.
 */
async function gatewayRequest(
  base: string,
  path: string,
  init: GatewayRequestInit,
  options: AssertGatewayUrlOptions,
): Promise<Response> {
  const { trusted } = checkGatewayUrl(base, options)
  const url = `${base.replace(/\/$/, '')}${path}`
  if (trusted) {
    return fetch(url, {
      ...init,
      // SSRF hardening: do not auto-follow redirects, an allowlisted host could
      // otherwise 30x-redirect to an internal target after the URL passed checks.
      redirect: 'manual',
    })
  }
  return pinnedFetch(url, init)
}

/**
 * Fetch `base + path` from a gateway URL that a remote party chose (an agent's
 * reported gatewayUrl). Same checks as gatewayFetch, but the operator default
 * gets no exception.
 *
 * @throws {GatewayUrlError} (as a rejection) if the URL is not permitted.
 */
export function remoteGatewayFetch(
  base: string,
  path: string,
  init: GatewayRequestInit = {},
): Promise<Response> {
  return gatewayRequest(base, path, init, { trustDefault: false })
}

/**
 * Who chose the `gatewayUrl` passed to gatewayFetch.
 *
 * - `'operator'`: the operator, or a signed-in user's own browser (the
 *   `x-gateway-url` header). A URL equal to the operator default skips the
 *   https/allowlist/port/private-range checks, as the default may legitimately
 *   be http or loopback.
 * - `'remote'`: a remote party (for example the URL an agent reports at its
 *   handshake). The default gets no exception. Prefer remoteGatewayFetch.
 */
export type GatewayUrlSource = 'operator' | 'remote'

interface GatewayOptionsBase {
  token?: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Passing a `gatewayUrl` (even one that may be undefined at run time) requires
 * a `urlSource`, so a caller has to decide who chose the URL; leaving it out is
 * a compile error. With neither, the operator default gateway is used.
 */
export type GatewayOptions = GatewayOptionsBase &
  (
    | { gatewayUrl?: string; urlSource: GatewayUrlSource }
    | { gatewayUrl?: undefined; urlSource?: undefined }
  )

/**
 * The default exemption applies to the operator default (no URL, no source)
 * and to a URL the operator chose. It fails closed for a remote source and for
 * a URL without a source (a caller that bypassed the type).
 */
function isOperatorChosen(options: GatewayOptions): boolean {
  if (options.urlSource === 'operator') return true
  return options.gatewayUrl === undefined && options.urlSource === undefined
}

/**
 * Fetch from the OpenClaw Gateway.
 * Falls back to env-configured default if no instance provided.
 *
 * A `gatewayUrl` needs a `urlSource` (see GatewayUrlSource). A URL other than
 * the operator default is checked against the allowlist and
 * port rule, and its host name is resolved once and pinned (see pinnedFetch).
 */
export async function gatewayFetch(
  path: string,
  options: GatewayOptions = {}
): Promise<Response> {
  const base = options.gatewayUrl ?? DEFAULT_GATEWAY_URL
  const token = options.token ?? DEFAULT_GATEWAY_TOKEN

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // SSRF guard: reject attacker-controlled gateway hosts before fetching.
  return gatewayRequest(
    base,
    path,
    {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    },
    { trustDefault: isOperatorChosen(options) },
  )
}

/**
 * Convenience: fetch JSON from Gateway.
 */
export async function gatewayJson<T>(
  path: string,
  options: GatewayOptions = {}
): Promise<T> {
  const res = await gatewayFetch(path, options)
  if (!res.ok) {
    // An unread body keeps its connection open until it is collected.
    await res.body?.cancel()
    throw new Error(`Gateway ${path} returned ${res.status}`)
  }
  return res.json() as Promise<T>
}
