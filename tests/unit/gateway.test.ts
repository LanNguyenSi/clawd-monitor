/**
 * SSRF-guard unit tests for src/lib/gateway.ts
 *
 * assertGatewayUrlAllowed reads DEFAULT_GATEWAY_URL and ALLOWED_GATEWAY_HOSTS
 * at module load time, so tests that need different env values reload the module
 * via vi.resetModules() + dynamic import.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

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
    expect(() => mod.assertGatewayUrlAllowed('http://localhost:9500')).not.toThrow()
  })

  it('returns a URL object on success', () => {
    const result = mod.assertGatewayUrlAllowed('http://localhost:9500')
    expect(result).toBeInstanceOf(URL)
    expect(result.href).toBe('http://localhost:9500/')
  })

  // ── Rejection: unparseable URL ────────────────────────────────────────────

  it('throws GatewayUrlError for a completely unparseable URL', () => {
    expect(() => mod.assertGatewayUrlAllowed('not a url')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('not a url')).toThrow('Invalid gateway URL')
  })

  it('throws for an empty string', () => {
    expect(() => mod.assertGatewayUrlAllowed('')).toThrow(mod.GatewayUrlError)
  })

  // ── Rejection: non-https scheme ───────────────────────────────────────────

  it('throws for http:// (non-default URL)', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('http://example.com')).toThrow('Gateway URL must use https')
  })

  it('throws for ftp:// scheme', () => {
    expect(() => mod.assertGatewayUrlAllowed('ftp://example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('ftp://example.com')).toThrow('Gateway URL must use https')
  })

  it('throws for ws:// scheme', () => {
    expect(() => mod.assertGatewayUrlAllowed('ws://example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('ws://example.com')).toThrow('Gateway URL must use https')
  })

  // ── Rejection: host not in allowlist (allowlist is empty) ────────────────

  it('throws for a public https URL when ALLOWED_GATEWAY_HOSTS is empty', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://example.com')).toThrow('Gateway host not allowed')
  })

  // With empty allowlist ALL https non-default URLs are rejected at the allowlist
  // check, giving defence-in-depth against every private range.

  it('throws for https://10.0.0.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://172.16.0.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://172.16.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://192.168.1.1 (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://192.168.1.1')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://127.0.0.1 (loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://127.0.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[::1] (IPv6 loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::1]')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[fe80::1] (IPv6 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fe80::1]')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[fd00::1] (IPv6 unique-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fd00::1]')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://[::ffff:10.0.0.1] (rejected via allowlist; host hex-normalized)', () => {
    // NOTE: asserts allowlist rejection ONLY. The WHATWG URL API normalises
    // ::ffff:10.0.0.1 to hex ::ffff:a00:1 in the hostname, so the allowlist check
    // fires before isPrivateHost — the IPv4-mapped private-range branch is NOT
    // exercised here. See the "isPrivateHost (direct)" block for that branch, and
    // the follow-up task for the latent hex-normalization SSRF bypass.
    expect(() => mod.assertGatewayUrlAllowed('https://[::ffff:10.0.0.1]')).toThrow(mod.GatewayUrlError)
  })

  it('throws for https://169.254.0.1 (IPv4 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://169.254.0.1')).toThrow(mod.GatewayUrlError)
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
    expect(() => mod.assertGatewayUrlAllowed('https://example.com')).not.toThrow()
  })

  it('accepts https://other.example.org when it is in the allowlist', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://other.example.org')).not.toThrow()
  })

  it('rejects https://NOT.example.com (not in allowlist)', () => {
    // Subdomain of an allowed host is not itself allowed
    expect(() => mod.assertGatewayUrlAllowed('https://NOT.example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://NOT.example.com')).toThrow('Gateway host not allowed')
  })

  it('rejects http://example.com (allowlisted but wrong scheme)', () => {
    expect(() => mod.assertGatewayUrlAllowed('http://example.com')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('http://example.com')).toThrow('Gateway URL must use https')
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
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1')).toThrow(mod.GatewayUrlError)
    expect(() => mod.assertGatewayUrlAllowed('https://10.0.0.1')).toThrow('Gateway host not allowed')
  })

  it('rejects https://172.16.0.1 even when allowlisted (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://172.16.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://192.168.1.1 even when allowlisted (RFC-1918)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://192.168.1.1')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://127.0.0.1 even when allowlisted (loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://127.0.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://169.254.0.1 even when allowlisted (link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://169.254.0.1')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[::1] even when allowlisted (IPv6 loopback)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[::1]')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[fe80::1] even when allowlisted (IPv6 link-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fe80::1]')).toThrow(mod.GatewayUrlError)
  })

  it('rejects https://[fd00::1] even when allowlisted (IPv6 unique-local)', () => {
    expect(() => mod.assertGatewayUrlAllowed('https://[fd00::1]')).toThrow(mod.GatewayUrlError)
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
    // Load with no env overrides → DEFAULT_GATEWAY_URL = 'http://localhost:9500'
    mod = await loadGateway({})
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
    mod = await loadGateway({})
  })

  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

  it('rejects with GatewayUrlError and does NOT call fetch for an http non-default URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // 'http://evil.com' is not the default URL and is not https → GatewayUrlError
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'http://evil.com' }))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects with GatewayUrlError for an https non-allowlisted URL and does NOT call fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // 'https://example.com' passes protocol check but fails allowlist (empty allowlist)
    await expect(mod.gatewayFetch('/x', { gatewayUrl: 'https://example.com' }))
      .rejects.toBeInstanceOf(mod.GatewayUrlError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── gatewayJson ───────────────────────────────────────────────────────────────

describe('gatewayJson – ok and not-ok responses', () => {
  let mod: Awaited<ReturnType<typeof loadGateway>>

  beforeAll(async () => {
    mod = await loadGateway({})
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
