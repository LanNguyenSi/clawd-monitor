/**
 * SSRF-guard unit tests for src/lib/gateway.ts
 *
 * assertGatewayUrlAllowed reads DEFAULT_GATEWAY_URL and ALLOWED_GATEWAY_HOSTS
 * at module load time, so tests that need different env values reload the module
 * via vi.resetModules() + dynamic import.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Load the gateway module with the given env overrides. */
async function loadGateway(env: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.resetModules()
  return import('@/lib/gateway')
}

// ── GatewayUrlError ───────────────────────────────────────────────────────────

describe('GatewayUrlError', () => {
  it('is an instance of Error with the correct name', async () => {
    const { GatewayUrlError } = await loadGateway()
    const err = new GatewayUrlError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('GatewayUrlError')
    expect(err.message).toBe('boom')
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })
})

// ── assertGatewayUrlAllowed — default env (empty ALLOWED_GATEWAY_HOSTS) ───────

describe('assertGatewayUrlAllowed – default env', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: '',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  // ── Acceptance: operator-configured default is always trusted ────────────

  it('accepts the operator-configured default URL verbatim', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: true })).not.toThrow()
  })

  it('returns a URL object on success', () => {
    const result = mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: true })
    expect(result).toBeInstanceOf(URL)
    expect(result.href).toBe('http://localhost:9500/')
  })

  // ── trustDefault option: who wins when the URL equals the default ─────────

  it('trusts the default when trustDefault is true', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: true })).not.toThrow()
  })

  it('gives the default no exception when the options object carries no trustDefault (a caller that bypasses the type)', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', {} as never)).toThrow('Gateway URL must use https')
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: undefined } as never)).toThrow('Gateway URL must use https')
  })

  it('gives the default no exception when trustDefault is false', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: false })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500', { trustDefault: false })).toThrow('Gateway URL must use https')
  })

  it('leaves every other URL unaffected by trustDefault', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: true })).toThrow('Gateway URL must use https')
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: false })).toThrow('Gateway URL must use https')
  })

  // ── Rejection: unparseable URL ────────────────────────────────────────────

  it('throws GatewayUrlError for a completely unparseable URL', () => {
    expect(() => mod.assertGatewayUrlAllowed('not a url', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('not a url', { trustDefault: true })).toThrow('Invalid gateway URL')
  })

  it('throws for an empty string', () => {
    expect(() => mod.assertGatewayUrlAllowed('', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  // ── Rejection: non-https scheme ───────────────────────────────────────────

  it('throws for http:// (non-default URL)', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: true })).toThrow('Gateway URL must use https')
  })

  it('throws for ftp:// scheme', () => {
    expect(() => mod.assertGatewayUrlAllowed('ftp://example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('ftp://example.com', { trustDefault: true })).toThrow('Gateway URL must use https')
  })

  it('throws for ws:// scheme', () => {
    expect(() => mod.assertGatewayUrlAllowed('ws://example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('ws://example.com', { trustDefault: true })).toThrow('Gateway URL must use https')
  })

  // ── Rejection: host not in allowlist (allowlist is empty) ────────────────

  it('throws for a public https URL when ALLOWED_GATEWAY_HOSTS is empty', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://example.com', { trustDefault: true })).toThrow('Gateway host not allowed')
  })

  // With empty allowlist ALL https non-default URLs are rejected at the allowlist
  // check, giving defence-in-depth against every private range.

  it('throws for https://10.0.0.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://172.16.0.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://172.16.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://192.168.1.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://192.168.1.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://127.0.0.1 (loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://127.0.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[::1] (IPv6 loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[fe80::1] (IPv6 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fe80::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[fd00::1] (IPv6 unique-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fd00::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[::ffff:10.0.0.1] (rejected via allowlist; host hex-normalized)', () => {
    // NOTE: asserts allowlist rejection ONLY. The WHATWG URL API normalises
    // ::ffff:10.0.0.1 to hex ::ffff:a00:1 in the hostname, so the allowlist check
    // fires before isPrivateHost is even reached. The isPrivateHost hex-mapped
    // branch itself (needed for the case where the hex-normalized host IS
    // allowlisted) is covered directly in "isPrivateHost (direct)" and via the
    // URL path in the "allowlisted public host" describe block below.
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:10.0.0.1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://169.254.0.1 (IPv4 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://169.254.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })
})

// ── assertGatewayUrlAllowed — with allowlist set (public host accepted) ───────

describe('assertGatewayUrlAllowed – allowlisted public host', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: 'example.com,other.example.org',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('accepts https://example.com when it is in the allowlist', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://example.com', { trustDefault: true })).not.toThrow()
  })

  it('accepts https://other.example.org when it is in the allowlist', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://other.example.org', { trustDefault: true })).not.toThrow()
  })

  it('rejects https://NOT.example.com (not in allowlist)', () => {
    // Subdomain of an allowed host is not itself allowed
    expect(() => mod.assertGatewayUrlAllowed('https://NOT.example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://NOT.example.com', { trustDefault: true })).toThrow('Gateway host not allowed')
  })

  it('rejects http://example.com (allowlisted but wrong scheme)', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('http://example.com', { trustDefault: true })).toThrow('Gateway URL must use https')
  })
})

// ── assertGatewayUrlAllowed, trustDefault false, allowlisted https ───────────

describe('assertGatewayUrlAllowed – trustDefault false with an allowlisted default', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'https://example.com',
      ALLOWED_GATEWAY_HOSTS: 'example.com',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('still accepts the default when it passes the full rule on its own', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://example.com', { trustDefault: false })).not.toThrow()
  })
})

// ── assertGatewayUrlAllowed — defence-in-depth: private hosts in allowlist ────
//
// Even if an operator mistakenly adds a private IP to ALLOWED_GATEWAY_HOSTS,
// the isPrivateHost() guard must still reject it.

describe('assertGatewayUrlAllowed – defence-in-depth (private hosts in allowlist)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  // Populate the allowlist with every private-range host we want to test.
  // IPv6 URLs have the brackets as part of the hostname (WHATWG URL spec).
  const PRIVATE_HOSTS =
    '10.0.0.1,172.16.0.1,192.168.1.1,127.0.0.1,169.254.0.1,[::1],[fe80::1],[fd00::1]'

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: PRIVATE_HOSTS,
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('rejects https://10.0.0.1 even when explicitly allowlisted (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1', { trustDefault: true })).toThrow('Gateway host not allowed')
  })

  it('rejects https://172.16.0.1 even when allowlisted (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://172.16.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://192.168.1.1 even when allowlisted (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://192.168.1.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://127.0.0.1 even when allowlisted (loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://127.0.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://169.254.0.1 even when allowlisted (link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://169.254.0.1', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[::1] even when allowlisted (IPv6 loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[fe80::1] even when allowlisted (IPv6 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fe80::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[fd00::1] even when allowlisted (IPv6 unique-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fd00::1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
  })
})

// ── assertGatewayUrlAllowed — defence-in-depth: hex-normalized IPv4-mapped ────
//
// The WHATWG URL parser normalizes IPv4-mapped IPv6 hosts to hex groups
// (::ffff:10.0.0.1 -> ::ffff:a00:1). If an operator allowlists that exact
// hex-normalized hostname, the allowlist check alone would let it through;
// the isPrivateHost() guard must still reject it via the hex-mapped branch.

describe('assertGatewayUrlAllowed – defence-in-depth (hex-normalized IPv4-mapped host allowlisted)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      // Hex-normalized hostnames for ::ffff:10.0.0.1 and ::ffff:127.0.0.1.
      ALLOWED_GATEWAY_HOSTS: '[::ffff:a00:1],[::ffff:7f00:1]',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('rejects https://[::ffff:10.0.0.1] even when its hex-normalized host is allowlisted', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:10.0.0.1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:10.0.0.1]', { trustDefault: true })).toThrow('Gateway host not allowed')
  })

  it('rejects https://[::ffff:127.0.0.1] even when its hex-normalized host is allowlisted', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:127.0.0.1]', { trustDefault: true })).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:127.0.0.1]', { trustDefault: true })).toThrow('Gateway host not allowed')
  })
})

// ── isPrivateHost (direct) — covers the IPv4-mapped branch unreachable via URL ──
//
// assertGatewayUrlAllowed cannot reach the dotted-decimal IPv4-mapped branch of
// isPrivateHost: the WHATWG URL parser rewrites ::ffff:10.0.0.1 to hex form. We
// exercise isPrivateHost directly to pin the IPv4-mapped recursion + core ranges.
describe('isPrivateHost (direct)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>
  beforeAll(async () => { mod = await loadGateway() })
  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('detects dotted-decimal IPv4-mapped IPv6 private addresses', () => {
    expect(mod.isPrivateHost('::ffff:10.0.0.1')).toBe(true)
    expect(mod.isPrivateHost('::ffff:127.0.0.1')).toBe(true)
    expect(mod.isPrivateHost('::ffff:192.168.1.1')).toBe(true)
  })

  it('does not flag a public dotted-decimal IPv4-mapped address', () => {
    expect(mod.isPrivateHost('::ffff:8.8.8.8')).toBe(false)
  })

  it('detects hex-normalized IPv4-mapped IPv6 private addresses (WHATWG URL form)', () => {
    expect(mod.isPrivateHost('::ffff:a00:1')).toBe(true) // 10.0.0.1
    expect(mod.isPrivateHost('::ffff:7f00:1')).toBe(true) // 127.0.0.1
    expect(mod.isPrivateHost('::ffff:c0a8:101')).toBe(true) // 192.168.1.1
  })

  it('does not flag a public hex-normalized IPv4-mapped address', () => {
    expect(mod.isPrivateHost('::ffff:808:808')).toBe(false) // 8.8.8.8
  })

  it('detects core private / loopback / link-local ranges', () => {
    expect(mod.isPrivateHost('localhost')).toBe(true)
    expect(mod.isPrivateHost('::1')).toBe(true)
    expect(mod.isPrivateHost('fe80::1')).toBe(true)
    expect(mod.isPrivateHost('fd00::1')).toBe(true)
    expect(mod.isPrivateHost('10.0.0.1')).toBe(true)
    expect(mod.isPrivateHost('169.254.0.1')).toBe(true)
  })

  it('does not flag public hosts', () => {
    expect(mod.isPrivateHost('example.com')).toBe(false)
    expect(mod.isPrivateHost('8.8.8.8')).toBe(false)
  })
})

// ── gatewayFetch ──────────────────────────────────────────────────────────────
//
// DEFAULT_GATEWAY_URL defaults to 'http://localhost:9500' when
// NEXT_PUBLIC_DEFAULT_GATEWAY_URL is not set. assertGatewayUrlAllowed trusts
// that URL verbatim (early-return), so gatewayFetch can reach the fetch() call.
// global fetch is replaced with vi.stubGlobal so no real network is used.

describe('gatewayFetch – happy path (default gateway URL)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    // Pin env explicitly so the default URL / empty allowlist do not depend on the ambient runner env.
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: '',
      DEFAULT_GATEWAY_TOKEN: '',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

  it('calls fetch once with the constructed URL, method GET, and redirect:manual', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response))

    await mod.gatewayFetch('/health')

    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:9500/health')
    expect(opts.method).toBe('GET')
    expect(opts.redirect).toBe('manual')
  })

  it('includes Authorization: Bearer header when a token is provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))

    await mod.gatewayFetch('/health', { token: 'tok123' })

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123')
  })

  it('omits Authorization header when token is an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))

    await mod.gatewayFetch('/health', { token: '' })

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('omits Authorization header when no token option is passed (DEFAULT_GATEWAY_TOKEN is empty)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))

    await mod.gatewayFetch('/health')

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })
})

describe('gatewayFetch – SSRF rejection (attacker-supplied http URL)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: '',
      DEFAULT_GATEWAY_TOKEN: '',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

  it('rejects with GatewayUrlError and does NOT call fetch for an http non-default URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // 'http://evil.com' is not the default URL and is not https → GatewayUrlError
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'http://evil.com', urlSource: 'operator' }))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects with GatewayUrlError for an https non-allowlisted URL and does NOT call fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // 'https://example.com' passes protocol check but fails allowlist (empty allowlist)
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'https://example.com', urlSource: 'operator' }))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── gatewayJson ───────────────────────────────────────────────────────────────

describe('gatewayJson – ok and not-ok responses', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: '',
      DEFAULT_GATEWAY_TOKEN: '',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

  it('returns parsed JSON when the response is ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ a: 1, b: 'hello' }),
    } as unknown as Response))

    const result = await mod.gatewayJson<{ a: number; b: string }>('/api/data')
    expect(result).toEqual({ a: 1, b: 'hello' })
  })

  it('throws an Error matching /returned 500/ when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response))

    await expect(mod.gatewayJson('/api/data')).rejects.toThrow(/returned 500/)
  })

  it('throws an Error matching /returned 404/ for a 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response))

    await expect(mod.gatewayJson('/missing')).rejects.toThrow(/returned 404/)
  })
})

// ── isPrivateHost: address classes a resolved name can answer with ───────────
//
// The same classifier judges the literal host of a gateway URL and every
// address its host name resolves to.

describe('isPrivateHost (address classes)', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>
  beforeAll(async () => { mod = await loadGateway() })
  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it.each([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', '0.0.0.0/8'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback range end'],
    ['10.255.255.255', '10/8'],
    ['100.64.0.1', 'CGNAT start'],
    ['100.127.255.254', 'CGNAT end'],
    ['169.254.169.254', 'cloud metadata link-local'],
    ['172.16.0.1', '172.16/12 start'],
    ['172.31.255.255', '172.16/12 end'],
    ['192.168.0.1', '192.168/16'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['198.18.0.1', 'benchmarking start'],
    ['198.19.255.255', 'benchmarking end'],
    ['192.0.2.0', 'TEST-NET-1 start'],
    ['192.0.2.255', 'TEST-NET-1 end'],
    ['198.51.100.0', 'TEST-NET-2 start'],
    ['198.51.100.255', 'TEST-NET-2 end'],
    ['203.0.113.0', 'TEST-NET-3 start'],
    ['203.0.113.255', 'TEST-NET-3 end'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'IPv6 unspecified'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'unique-local start'],
    ['fdff::1', 'unique-local end'],
    ['fe80::1', 'link-local'],
    ['fe90::1', 'link-local, upper part of fe80::/10'],
    ['febf::1', 'link-local end'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address'],
    ['0:0:0:0:0:ffff:7f00:1', 'IPv4-mapped, long form'],
    ['::7f00:1', 'IPv4-compatible loopback'],
    ['::127.0.0.1', 'IPv4-compatible loopback, dotted'],
    ['64:ff9b::7f00:1', 'NAT64 embedding loopback'],
    ['2002:7f00:1::', '6to4 embedding loopback'],
    ['::ffff:0:808:808', 'IPv4-translated (SIIT), even for a public embedded address'],
    ['::ffff:0:0:0', 'IPv4-translated, all zero'],
    ['64:ff9b:1::1', 'local-use NAT64 (RFC 8215) start'],
    ['64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'local-use NAT64 end'],
    ['100::', 'discard-only prefix start'],
    ['100::ffff:ffff:ffff:ffff', 'discard-only prefix end'],
    ['2001::', 'Teredo start'],
    ['2001:0:ffff:ffff:ffff:ffff:ffff:ffff', 'Teredo end'],
    ['2001:db8::', 'documentation start'],
    ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'documentation end'],
    ['2001:0db8::1', 'documentation, leading zero'],
    ['LOCALHOST', 'name in upper case'],
    ['API.LOCALHOST', 'name under .localhost in upper case'],
    ['::FFFF:7F00:1', 'IPv4-mapped loopback in upper case'],
    ['FE80::1', 'link-local in upper case'],
    ['[::1]', 'bracketed loopback'],
    ['fe80::1%en0', 'zone id (unparseable, fails closed)'],
    ['1:2:3', 'malformed (fails closed)'],
    ['1::2::3', 'two compressions (fails closed)'],
    ['1:2:3:4:5:6:7:8::9::10', 'three parts around :: (fails closed)'],
    ['1:2:3:4:5:6:7:8::', ':: with no group to stand for (fails closed)'],
    ['1:2:3:4:5:6:7::8', ':: next to seven groups (fails closed)'],
    ['1:2:3:4:5:6:7:8:9', 'nine groups (fails closed)'],
    ['xyz::1', 'non-hex group (fails closed)'],
    ['12345::1', 'five-digit group (fails closed)'],
    ['::ffff:300.1.1.1', 'bad octet (fails closed)'],
    ['::ffff:8.8.8.256', 'octet 256 (fails closed)'],
    ['localhost', 'name'],
    ['api.localhost', 'name under .localhost'],
  ])('flags %s (%s)', (address) => {
    expect(mod.isPrivateHost(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.254',
    '2606:4700::1111',
    '2001:4860:4860::8888',
    '192.0.3.1',
    '192.0.1.255',
    '198.51.99.255',
    '198.51.101.1',
    '203.0.112.255',
    '203.0.114.1',
    '::ffff:1:808:808',
    '::fffe:0:808:808',
    '64:ff9b:2::1',
    '64:ff9a:1::1',
    '100:0:0:1::1',
    '101::',
    '2001:1::1',
    '2001:db9::1',
    '2001:db7:ffff::1',
    '2001:4000::1',
    '2A00:1450::1',
    '::FFFF:808:808',
    'EXAMPLE.COM',
    '2002:808:808::',
    '64:ff9b::808:808',
    '::ffff:8.8.8.8',
    '::8.8.8.8',
    'fe7f::1',
    'example.com',
  ])('does not flag %s', (address) => {
    expect(mod.isPrivateHost(address)).toBe(false)
  })
})

// ── ALLOWED_GATEWAY_HOSTS ports ──────────────────────────────────────────────

describe('assertGatewayUrlAllowed, port policy', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: [
        'plain.example.com',
        'ported.example.com:8443',
        'Mixed.Example.com:9443',
        'multi.example.com',
        'multi.example.com:8443',
        '[2606:4700::1111]',
        '[2606:4700::2222]:8443',
        'zero.example.com:0',
        'huge.example.com:65536',
        'text.example.com:abc',
        'empty.example.com:',
        'sci.example.com:8e3',
        'hex.example.com:0x1f90',
        'space.example.com: 8443',
        'v6bare:1:2',
        ':8443',
      ].join(','),
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  const check = (url: string) => mod.assertGatewayUrlAllowed(url, { trustDefault: false })

  it('lets an entry without a port allow the default https port only', () => {
    expect(() => check('https://plain.example.com')).not.toThrow()
    expect(() => check('https://plain.example.com:443')).not.toThrow()
    expect(() => check('https://plain.example.com:8443')).toThrow('Gateway port not allowed')
    expect(() => check('https://plain.example.com:80')).toThrow('Gateway port not allowed')
  })

  it('lets an entry with a port allow that port only, not the default one', () => {
    expect(() => check('https://ported.example.com:8443')).not.toThrow()
    expect(() => check('https://ported.example.com')).toThrow('Gateway port not allowed')
    expect(() => check('https://ported.example.com:443')).toThrow('Gateway port not allowed')
    expect(() => check('https://ported.example.com:9443')).toThrow('Gateway port not allowed')
  })

  it('compares the host case-insensitively on both sides', () => {
    expect(() => check('https://MIXED.example.com:9443')).not.toThrow()
    expect(() => check('https://mixed.example.com:8443')).toThrow('Gateway port not allowed')
  })

  it('accepts every port listed for the same host and no other', () => {
    expect(() => check('https://multi.example.com')).not.toThrow()
    expect(() => check('https://multi.example.com:8443')).not.toThrow()
    expect(() => check('https://multi.example.com:9000')).toThrow('Gateway port not allowed')
  })

  it('applies the port rule to bracketed IPv6 entries', () => {
    expect(() => check('https://[2606:4700::1111]')).not.toThrow()
    expect(() => check('https://[2606:4700::1111]:8443')).toThrow('Gateway port not allowed')
    expect(() => check('https://[2606:4700::2222]:8443')).not.toThrow()
    expect(() => check('https://[2606:4700::2222]')).toThrow('Gateway port not allowed')
  })

  it.each([
    ['port 0', 'zero.example.com'],
    ['port above 65535', 'huge.example.com'],
    ['a non-numeric port', 'text.example.com'],
    ['a trailing colon', 'empty.example.com'],
    ['an exponent port', 'sci.example.com'],
    ['a hex port', 'hex.example.com'],
    ['a port with a space', 'space.example.com'],
  ])('drops an entry with %s, so its host is not allowed at all', (_label, host) => {
    expect(() => check(`https://${host}`)).toThrow('Gateway host not allowed')
    expect(() => check(`https://${host}:8443`)).toThrow('Gateway host not allowed')
  })

  it('does not let malformed entries (unbracketed IPv6, missing host) widen the list', () => {
    expect(() => check('https://v6bare:1:2')).toThrow()
    expect(() => check('https://example.org:8443')).toThrow('Gateway host not allowed')
  })

  it('still reports a host outside the list as a host error, not a port error', () => {
    expect(() => check('https://other.example.com:8443')).toThrow('Gateway host not allowed')
  })

  it('does not let the port rule override the private-range guard', async () => {
    const m = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: '127.0.0.1:8443,100.64.0.1',
    })
    expect(() => m.assertGatewayUrlAllowed('https://127.0.0.1:8443', { trustDefault: false })).toThrow('Gateway host not allowed')
    expect(() => m.assertGatewayUrlAllowed('https://100.64.0.1', { trustDefault: false })).toThrow('Gateway host not allowed')
  })
})

// ── remote-chosen URLs: no default exemption ─────────────────────────────────

describe('assertRemoteGatewayUrl', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: 'gw.example.com',
    })
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('gives the operator default no exception', () => {
    expect(() => mod.assertRemoteGatewayUrl('http://localhost:9500')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertRemoteGatewayUrl('http://localhost:9500')).toThrow('Gateway URL must use https')
  })

  it('accepts an allowlisted https URL and returns it parsed', () => {
    expect(mod.assertRemoteGatewayUrl('https://gw.example.com/').hostname).toBe('gw.example.com')
  })

  it('applies host, scheme and port rules', () => {
    expect(() => mod.assertRemoteGatewayUrl('https://evil.example.net')).toThrow('Gateway host not allowed')
    expect(() => mod.assertRemoteGatewayUrl('http://gw.example.com')).toThrow('Gateway URL must use https')
    expect(() => mod.assertRemoteGatewayUrl('https://gw.example.com:9999')).toThrow('Gateway port not allowed')
    expect(() => mod.assertRemoteGatewayUrl('not a url')).toThrow('Invalid gateway URL')
  })
})

// ── transport selection: pinned fetch for everything but the trusted default ─

describe('gatewayFetch and remoteGatewayFetch, transport', () => {
  const pinned = vi.fn()
  const globalFetch = vi.fn()
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    vi.doMock('@/lib/pinned-fetch', () => ({ pinnedFetch: pinned }))
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'http://localhost:9500',
      ALLOWED_GATEWAY_HOSTS: 'gw.example.com',
      DEFAULT_GATEWAY_TOKEN: '',
    })
  })

  afterAll(() => {
    vi.doUnmock('@/lib/pinned-fetch')
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules()
  })

  beforeEach(() => {
    pinned.mockReset().mockResolvedValue(new Response('pinned'))
    globalFetch.mockReset().mockResolvedValue(new Response('global'))
    vi.stubGlobal('fetch', globalFetch)
  })

  it('sends the operator default through the global fetch, never the pinned one', async () => {
    await mod.gatewayFetch('/status')
    expect(globalFetch).toHaveBeenCalledTimes(1)
    expect(globalFetch.mock.calls[0][0]).toBe('http://localhost:9500/status')
    expect(pinned).not.toHaveBeenCalled()
  })

  it('sends an allowlisted URL through the pinned fetch, never the global one', async () => {
    const res = await mod.gatewayFetch('/status', {
      gatewayUrl: 'https://gw.example.com',
      urlSource: 'operator',
      token: 'tok',
      method: 'POST',
      body: { a: 1 },
    })
    expect(await res.text()).toBe('pinned')
    expect(globalFetch).not.toHaveBeenCalled()
    expect(pinned).toHaveBeenCalledTimes(1)
    const [url, init] = pinned.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('https://gw.example.com/status')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' })
  })

  it('checks the URL before any transport: a rejected URL reaches neither', async () => {
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'https://gw.example.com:9999', urlSource: 'operator' })).rejects.toThrow('Gateway port not allowed')
    expect(globalFetch).not.toHaveBeenCalled()
    expect(pinned).not.toHaveBeenCalled()
  })

  it('treats a remote-sourced gatewayUrl that equals the default as unexempt', async () => {
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500', urlSource: 'remote' }))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(pinned).not.toHaveBeenCalled()
  })

  it('applies the remote rule when the source is remote without a gatewayUrl (the default is not exempt)', async () => {
    await expect(mod.gatewayFetch('/x', { urlSource: 'remote' })).rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('exempts the default only for an operator-sourced URL or no URL at all', async () => {
    await mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500', urlSource: 'operator' })
    await mod.gatewayFetch('/x')
    await mod.gatewayFetch('/x', { urlSource: 'operator' })
    expect(globalFetch).toHaveBeenCalledTimes(3)
    expect(globalFetch.mock.calls.map((c) => c[0])).toEqual(Array(3).fill('http://localhost:9500/x'))
  })

  it('requires a urlSource whenever a gatewayUrl is passed (compile-time)', () => {
    // The checks below are type-level (type-check:tests compiles this file):
    // a call that leaves the trust decision out must not compile.
    const compileOnly = async () => {
      // @ts-expect-error a gatewayUrl without a urlSource
      await mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500' })
      // @ts-expect-error a possibly undefined gatewayUrl is still a gatewayUrl
      await mod.gatewayFetch('/x', { gatewayUrl: process.env.NOPE as string | undefined })
      // @ts-expect-error the former opt-out flag is gone
      await mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500', remoteChosen: true })
      // @ts-expect-error an unknown source
      await mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500', urlSource: 'user' })
      await mod.gatewayFetch('/x', { gatewayUrl: process.env.NOPE, urlSource: 'operator' })
      await mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500', urlSource: 'remote', token: 't' })
      await mod.gatewayFetch('/x', { token: 't' })
    }
    expect(typeof compileOnly).toBe('function')
  })

  it('fails closed at run time when a caller bypasses the type and omits the source', async () => {
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'http://localhost:9500' } as never))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(pinned).not.toHaveBeenCalled()
  })

  it('remoteGatewayFetch rejects the default URL as a promise and fetches nothing', async () => {
    const promise = mod.remoteGatewayFetch('http://localhost:9500', '/logs/stream')
    await expect(promise).rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(pinned).not.toHaveBeenCalled()
  })

  it('remoteGatewayFetch pins an allowlisted URL and drops one trailing slash of the base', async () => {
    await mod.remoteGatewayFetch('https://gw.example.com/', '/logs/stream?source=openclaw', {
      headers: { Authorization: 'Bearer t' },
    })
    expect(globalFetch).not.toHaveBeenCalled()
    const [url, init] = pinned.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('https://gw.example.com/logs/stream?source=openclaw')
    expect(init.headers).toEqual({ Authorization: 'Bearer t' })
  })
})

describe('operator default that is itself https and allowlisted', () => {
  const pinned = vi.fn()
  const globalFetch = vi.fn()
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    vi.doMock('@/lib/pinned-fetch', () => ({ pinnedFetch: pinned }))
    mod = await loadGateway({
      NEXT_PUBLIC_DEFAULT_GATEWAY_URL: 'https://gw.example.com',
      ALLOWED_GATEWAY_HOSTS: 'gw.example.com',
    })
  })

  afterAll(() => {
    vi.doUnmock('@/lib/pinned-fetch')
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules()
  })

  it('uses the global fetch for the trusted default and the pinned one when the source is remote', async () => {
    pinned.mockResolvedValue(new Response('pinned'))
    globalFetch.mockResolvedValue(new Response('global'))
    vi.stubGlobal('fetch', globalFetch)

    await mod.gatewayFetch('/a', { gatewayUrl: 'https://gw.example.com', urlSource: 'operator' })
    expect(globalFetch).toHaveBeenCalledTimes(1)
    expect(pinned).not.toHaveBeenCalled()

    await mod.gatewayFetch('/a', { gatewayUrl: 'https://gw.example.com', urlSource: 'remote' })
    expect(pinned).toHaveBeenCalledTimes(1)
    expect(globalFetch).toHaveBeenCalledTimes(1)
  })
})
