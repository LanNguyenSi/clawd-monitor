import type { IncomingMessage } from 'http'

/**
 * Header the custom server (server.ts) sets from the TCP peer address of every
 * request before Next.js sees it. Next.js does not expose the peer address to
 * route handlers (NextRequest has no `ip` in Next 15, and the node request's
 * socket is not reachable from the handler), and its own `x-forwarded-for`
 * fallback only fills the header when the client did not send one, so it cannot
 * tell a real peer from a forged header. The server overwrites this header on
 * every request, so a client-sent value never reaches a route.
 */
export const PEER_ADDR_HEADER = 'x-clawd-peer-addr'

/** Used when neither the peer address nor a trusted forwarded address is known. */
export const UNKNOWN_CLIENT_KEY = 'unknown'

/** Overwrite (or drop) the peer header with what the socket says. */
export function stampPeerAddress(req: IncomingMessage): void {
  const addr = req.socket?.remoteAddress
  if (addr) req.headers[PEER_ADDR_HEADER] = addr
  else delete req.headers[PEER_ADDR_HEADER]
}

/**
 * Wrap a request listener so every request is stamped with its socket peer
 * (replacing whatever the client sent under that name, in any letter case or
 * repeated) before the listener, and so Next.js, sees it. server.ts uses this
 * for its one request listener.
 */
export function withPeerAddress<Res>(
  listener: (req: IncomingMessage, res: Res) => void,
): (req: IncomingMessage, res: Res) => void {
  return (req, res) => {
    stampPeerAddress(req)
    listener(req, res)
  }
}

function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  // no leading zeros ("010" is read as octal by some parsers), each octet 0..255
  if (m.slice(1).some((p) => p.length > 1 && p.startsWith('0')) || parts.some((p) => p > 255)) return null
  return parts
}

// The eight 16-bit groups of an IPv6 literal, or null. The WHATWG URL parser
// validates the literal and rewrites it in one canonical form (lower case,
// compressed, an embedded IPv4 as two hex groups), which is then expanded.
function parseIpv6(s: string): number[] | null {
  if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return null
  let host: string
  try {
    host = new URL(`http://[${s}]/`).hostname
  } catch {
    return null
  }
  const halves = host.slice(1, -1).split('::')
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  return [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) => parseInt(g, 16))
}

/** Rate-limit keys of one client: its own, and for IPv6 the coarser /48 around it. */
export interface ClientKeys {
  key: string
  parent?: string
}

/**
 * Canonical keys for an address, or null when it is not an IP literal.
 * - IPv4 stays as is; an IPv4-mapped IPv6 address (::ffff:a.b.c.d) becomes the IPv4.
 * - Any other IPv6 address maps to its /64 prefix, because one subscriber
 *   routinely holds a whole /64 and could otherwise rotate through addresses,
 *   and carries its /48 as `parent`: one site holds 65,536 /64s, so a single
 *   /64 key alone would let it fill the limiter's table (see login-rate-limit.ts).
 * - A bracketed IPv6, an address with a port, and an IPv6 zone id are accepted.
 */
export function parseClient(raw: string | null | undefined): ClientKeys | null {
  if (!raw) return null
  let s = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracketed) {
    s = bracketed[1]
    if (!s.includes(':')) return null // brackets are for IPv6 only
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'))
  if (s.includes(':')) s = s.split('%')[0]
  const v4 = parseIpv4(s)
  if (v4) return { key: v4.join('.') }
  const g = parseIpv6(s)
  if (!g) return null
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return { key: `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}` }
  }
  const hex = (n: number) => g.slice(0, n).map((x) => x.toString(16)).join(':')
  return { key: `${hex(4)}::/64`, parent: `${hex(3)}::/48` }
}

/** The bucket key of an address (see parseClient), or null when it is not an IP literal. */
export function normalizeIp(raw: string | null | undefined): string | null {
  return parseClient(raw)?.key ?? null
}

/**
 * Parse TRUSTED_PROXY_HOPS. Absent, empty and whitespace-only mean 0 without a
 * complaint. A non-negative decimal integer (surrounding whitespace allowed) is
 * taken as is. Anything else (negative, fractional, text, a number too large to
 * be exact) is invalid and behaves like 0, so a typo can never make a forged
 * header trusted.
 */
export function parseTrustedProxyHops(raw: string | undefined): { hops: number; invalid: boolean } {
  if (raw === undefined || raw.trim() === '') return { hops: 0, invalid: false }
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return { hops: 0, invalid: true }
  const n = Number(t)
  if (!Number.isSafeInteger(n)) return { hops: 0, invalid: true }
  return { hops: n, invalid: false }
}

let warnedInvalidHops = false

/** TRUSTED_PROXY_HOPS from the environment; an invalid value is logged once per process. */
export function getTrustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const { hops, invalid } = parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS)
  if (invalid && !warnedInvalidHops) {
    warnedInvalidHops = true
    console.warn('[auth] TRUSTED_PROXY_HOPS is not a non-negative integer; treating it as 0 (X-Forwarded-For ignored)')
  }
  return hops
}

/**
 * Rate-limit keys for the client of a request.
 * - hops 0: the peer address the server stamped; X-Forwarded-For is ignored.
 * - hops N >= 1: the N-th address from the right of X-Forwarded-For, i.e. what
 *   the outermost of N trusted proxies saw. The list needs at least N entries;
 *   entries to the left of that one are client controlled and never used.
 *   When the header has fewer than N entries, or the chosen entry is not an IP
 *   literal, the request did not come through the configured chain as expected
 *   and the peer address is used instead.
 * - No usable peer address: one shared key, never one named by a header.
 * Several X-Forwarded-For header lines arrive joined by commas, which is the
 * same list a single line would carry.
 */
export function getClientKeys(headers: Headers, hops: number): ClientKeys {
  const peer = parseClient(headers.get(PEER_ADDR_HEADER)) ?? { key: UNKNOWN_CLIENT_KEY }
  const entries = (headers.get('x-forwarded-for') ?? '').split(',')
  // The last `hops` entries; its first element is the trusted one. A shorter
  // list does not describe the configured chain. With hops 0 this slice is the
  // whole list, which is never empty, so the length test is what makes 0 mean
  // "ignore the header".
  const chain = entries.slice(-hops)
  const trusted = chain.length === hops ? chain[0] : undefined
  return parseClient(trusted) ?? peer
}

/** The bucket key alone (see getClientKeys). */
export function getClientKey(headers: Headers, hops: number): string {
  return getClientKeys(headers, hops).key
}
