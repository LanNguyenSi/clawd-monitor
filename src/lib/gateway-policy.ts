/**
 * Address policy for outbound gateway requests: the error type routes map to
 * HTTP 400, and the one classifier that decides whether a host or an IP
 * address is a loopback, private or otherwise non-public target. It is used on
 * the literal host of a gateway URL and on every address a gateway host name
 * resolves to, so the two checks cannot drift apart.
 */

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

/** Non-public IPv4 range by its dotted-decimal octets. */
function isPrivateIPv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 127) return true // 0.0.0.0/8 unspecified, 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 carrier-grade NAT
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a >= 224) return true // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, broadcast
  return false
}

/**
 * Parse an IPv6 literal (with or without a dotted-decimal IPv4 tail) into its
 * eight 16-bit groups. Null when the text is not a valid IPv6 address, for
 * example one that carries a zone id.
 */
function parseIPv6(host: string): number[] | null {
  let text = host
  const tail = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (tail) {
    const octets = tail.slice(1).map(Number)
    if (octets.some((o) => o > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    text = `${text.slice(0, tail.index)}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): string[] => (part === '' ? [] : part.split(':'))
  const head = toGroups(halves[0])
  const rest = halves.length === 2 ? toGroups(halves[1]) : []
  // "::" stands for at least one group of zeros.
  if (halves.length === 2 && head.length + rest.length > 7) return null
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head
  if (groups.length !== 8) return null
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => Number.parseInt(g, 16))
}

function isPrivateIPv6(host: string): boolean {
  const g = parseIPv6(host)
  if (!g) return true // unparseable: fail closed
  const leadingZeros = (n: number) => g.slice(0, n).every((x) => x === 0)
  const embedded = (hi: number, lo: number) =>
    isPrivateIPv4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff)

  if (leadingZeros(7) && g[7] <= 1) return true // :: unspecified, ::1 loopback
  if (leadingZeros(5) && g[5] === 0xffff) return embedded(g[6], g[7]) // ::ffff:a.b.c.d IPv4-mapped
  if (leadingZeros(6)) return embedded(g[6], g[7]) // ::a.b.c.d IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return embedded(g[6], g[7]) // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) return embedded(g[1], g[2]) // 2002::/16 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/**
 * True for loopback / link-local / private-range / otherwise non-public hosts
 * (SSRF targets). Accepts a host name, an IPv4 address or an IPv6 address with
 * or without brackets. Host names other than localhost are not judged here.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) return isPrivateIPv6(host)
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) return isPrivateIPv4(Number(m[1]), Number(m[2]), Number(m[3]))
  return false
}
