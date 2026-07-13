/**
 * Gateway API client — proxies requests to the active OpenClaw instance.
 * Used server-side in API routes.
 */

const DEFAULT_GATEWAY_URL = process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL ?? 'http://localhost:9500'
const DEFAULT_GATEWAY_TOKEN = process.env.DEFAULT_GATEWAY_TOKEN ?? ''

// Hosts that callers may target via the `x-gateway-url` header, beyond the
// operator-configured default. Comma-separated, case-insensitive hostnames.
const ALLOWED_GATEWAY_HOSTS = (process.env.ALLOWED_GATEWAY_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

/**
 * Thrown when a requested gateway URL fails server-side SSRF validation.
 * Routes should map this to HTTP 400 (caller-supplied, not a gateway fault).
 */
export class GatewayUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayUrlError'
  }
}

/** True for loopback / link-local / private-range hosts (SSRF targets). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) {
    // IPv6
    if (host === '::1' || host === '::') return true // loopback / unspecified
    if (host.startsWith('fe80:')) return true // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true // fc00::/7 unique-local
    const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPrivateHost(mapped[1]) // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    // WHATWG URL normalizes IPv4-mapped IPv6 to hex groups, e.g.
    // ::ffff:10.0.0.1 -> ::ffff:a00:1 (so new URL(...).hostname never surfaces
    // the dotted-decimal form above). Decode the two hex groups back into the
    // embedded IPv4 address and reuse the dotted-decimal private-range logic.
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16)
      const low = Number.parseInt(mappedHex[2], 16)
      const a = (high >> 8) & 0xff
      const b = high & 0xff
      const c = (low >> 8) & 0xff
      const d = low & 0xff
      return isPrivateHost(`${a}.${b}.${c}.${d}`)
    }
    return false
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 0 || a === 127) return true // 0.0.0.0/8, 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  }
  return false
}

/**
 * Validate a resolved gateway URL against SSRF abuse before it is fetched.
 *
 * The operator-configured default is always trusted (it may legitimately be
 * http/loopback). Any caller-supplied override must be https, present in the
 * ALLOWED_GATEWAY_HOSTS allowlist, and not point at a private/loopback range.
 *
 * @throws {GatewayUrlError} if the URL is not permitted.
 */
export function assertGatewayUrlAllowed(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new GatewayUrlError('Invalid gateway URL')
  }

  // Trust the operator-configured default verbatim.
  if (rawUrl === DEFAULT_GATEWAY_URL) return parsed

  if (parsed.protocol !== 'https:') {
    throw new GatewayUrlError('Gateway URL must use https')
  }
  if (!ALLOWED_GATEWAY_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new GatewayUrlError('Gateway host not allowed')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new GatewayUrlError('Gateway host not allowed')
  }
  return parsed
}

export interface GatewayOptions {
  gatewayUrl?: string
  token?: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Fetch from the OpenClaw Gateway.
 * Falls back to env-configured default if no instance provided.
 */
export async function gatewayFetch(
  path: string,
  options: GatewayOptions = {}
): Promise<Response> {
  const base = options.gatewayUrl ?? DEFAULT_GATEWAY_URL
  // SSRF guard: reject attacker-controlled gateway hosts before fetching.
  assertGatewayUrlAllowed(base)
  const url = `${base}${path}`
  const token = options.token ?? DEFAULT_GATEWAY_TOKEN

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    // SSRF hardening: do not auto-follow redirects, an allowlisted host could
    // otherwise 30x-redirect to an internal target after the URL passed checks.
    redirect: 'manual',
  })
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
    throw new Error(`Gateway ${path} returned ${res.status}`)
  }
  return res.json() as Promise<T>
}
