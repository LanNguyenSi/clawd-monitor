/**
 * Unit tests for POST /api/auth (src/app/api/auth/route.ts): password
 * precedence, the per-client login limiter and the client key it uses.
 *
 * The password store is mocked. The limiter is a module-level singleton, so the
 * route is re-imported per test (vi.resetModules) to start every test with an
 * empty limiter; the mock factories are not re-run by resetModules, so the
 * statically imported spies stay valid.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/data-store', () => ({ readPasswordConfig: vi.fn(() => ({})) }))
vi.mock('@/lib/secure-compare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/secure-compare')>()
  return { safeEqual: vi.fn(actual.safeEqual) }
})
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('bcryptjs') }>()
  return { default: { ...actual.default, compare: vi.fn(actual.default.compare) } }
})

import { readPasswordConfig } from '@/lib/data-store'
import { safeEqual } from '@/lib/secure-compare'
import { PEER_ADDR_HEADER } from '@/lib/client-ip'

const storeMock = vi.mocked(readPasswordConfig)
const safeEqualMock = vi.mocked(safeEqual)
const compareMock = vi.mocked(bcrypt.compare)

const WINDOW_MS = 15 * 60 * 1000
const BCRYPT_COST = 4 // see api-change-password.test.ts: the cost does not matter here

let POST: typeof import('@/app/api/auth/route').POST

function login(
  password: unknown,
  opts: { peer?: string | null; xff?: string; body?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {}
  const peer = opts.peer === undefined ? '10.0.0.1' : opts.peer
  if (peer !== null) headers[PEER_ADDR_HEADER] = peer
  if (opts.xff !== undefined) headers['x-forwarded-for'] = opts.xff
  return new NextRequest('http://localhost/api/auth', {
    method: 'POST',
    headers,
    body: opts.body ?? JSON.stringify({ password }),
  })
}

async function statusOf(req: NextRequest): Promise<number> {
  return (await POST(req)).status
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  vi.stubEnv('ADMIN_PASSWORD_HASH', '')
  vi.stubEnv('ADMIN_PASSWORD', 'correct-horse')
  vi.stubEnv('JWT_SECRET', 'test-secret-test-secret-test-secret')
  vi.stubEnv('TRUSTED_PROXY_HOPS', '')
  storeMock.mockReset().mockReturnValue({})
  // reset (not just clear) so a per-test implementation does not leak on; vitest
  // restores the implementation the mock was created with
  safeEqualMock.mockReset()
  compareMock.mockReset()
  vi.resetModules()
  POST = (await import('@/app/api/auth/route')).POST
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('limit and lockout', () => {
  it('answers 401 for the first five wrong passwords and 429 for the sixth', async () => {
    for (let i = 0; i < 5; i++) expect(await statusOf(login('wrong'))).toBe(401)
    const res = await POST(login('wrong'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe(String(WINDOW_MS / 1000))
    expect(await res.json()).toEqual({ error: 'Too many failed login attempts. Try again later.' })
  })

  it('does not check the password once the limit is reached, so the right one gets no answer either', async () => {
    for (let i = 0; i < 5; i++) await POST(login('wrong'))
    expect(safeEqualMock).toHaveBeenCalledTimes(5)
    const res = await POST(login('correct-horse'))
    expect(res.status).toBe(429)
    expect(safeEqualMock).toHaveBeenCalledTimes(5)
    expect(res.cookies.get('token')).toBeUndefined()
  })

  it('does not call bcrypt either when the limit is reached (hash from the store)', async () => {
    storeMock.mockReturnValue({ hash: await bcrypt.hash('stored-pass', BCRYPT_COST) })
    compareMock.mockClear()
    for (let i = 0; i < 5; i++) expect(await statusOf(login('wrong'))).toBe(401)
    expect(compareMock).toHaveBeenCalledTimes(5)
    expect(await statusOf(login('stored-pass'))).toBe(429)
    expect(compareMock).toHaveBeenCalledTimes(5)
  })

  it('counts down Retry-After as the window runs', async () => {
    for (let i = 0; i < 5; i++) await POST(login('wrong'))
    vi.advanceTimersByTime(10 * 60 * 1000)
    const res = await POST(login('wrong'))
    expect(res.headers.get('Retry-After')).toBe('300')
  })

  it('lets the client try again when the window has passed', async () => {
    for (let i = 0; i < 5; i++) await POST(login('wrong'))
    expect(await statusOf(login('correct-horse'))).toBe(429)
    vi.advanceTimersByTime(WINDOW_MS - 1)
    expect(await statusOf(login('correct-horse'))).toBe(429)
    vi.advanceTimersByTime(1)
    expect(await statusOf(login('correct-horse'))).toBe(200)
  })

  it('starts a fresh budget after the window, with five more failures', async () => {
    for (let i = 0; i < 5; i++) await POST(login('wrong'))
    vi.advanceTimersByTime(WINDOW_MS)
    for (let i = 0; i < 5; i++) expect(await statusOf(login('wrong'))).toBe(401)
    expect(await statusOf(login('wrong'))).toBe(429)
  })

  it('keeps clients apart: one locked-out client does not lock another', async () => {
    for (let i = 0; i < 5; i++) await POST(login('wrong', { peer: '10.0.0.1' }))
    expect(await statusOf(login('wrong', { peer: '10.0.0.1' }))).toBe(429)
    expect(await statusOf(login('correct-horse', { peer: '10.0.0.2' }))).toBe(200)
  })

  it('does not let parallel requests get past the limit before the first one has failed', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    storeMock.mockReturnValue({ hash: await bcrypt.hash('stored-pass', BCRYPT_COST) })
    compareMock.mockImplementation(async () => {
      await gate
      return false
    })
    const pending = Array.from({ length: 12 }, () => POST(login('guess')))
    // admission is decided synchronously, before any of the checks has finished
    await vi.advanceTimersByTimeAsync(0)
    release()
    const statuses = (await Promise.all(pending)).map((r) => r.status)
    expect(statuses.filter((s) => s === 401)).toHaveLength(5)
    expect(statuses.filter((s) => s === 429)).toHaveLength(7)
    expect(compareMock).toHaveBeenCalledTimes(5)
  })
})

describe('success', () => {
  it('resets the client: four failures, a login, then a full budget again', async () => {
    for (let i = 0; i < 4; i++) expect(await statusOf(login('wrong'))).toBe(401)
    const ok = await POST(login('correct-horse'))
    expect(ok.status).toBe(200)
    expect(ok.cookies.get('token')?.value).toBeTruthy()
    for (let i = 0; i < 5; i++) expect(await statusOf(login('wrong'))).toBe(401)
    expect(await statusOf(login('wrong'))).toBe(429)
  })

  it('resets only the client that logged in', async () => {
    for (let i = 0; i < 4; i++) await POST(login('wrong', { peer: '10.0.0.1' }))
    for (let i = 0; i < 4; i++) await POST(login('wrong', { peer: '10.0.0.2' }))
    expect(await statusOf(login('correct-horse', { peer: '10.0.0.1' }))).toBe(200)
    // 10.0.0.2 has one attempt left
    expect(await statusOf(login('wrong', { peer: '10.0.0.2' }))).toBe(401)
    expect(await statusOf(login('wrong', { peer: '10.0.0.2' }))).toBe(429)
  })
})

describe('which requests use up an attempt', () => {
  it('invalid JSON and a missing password do not', async () => {
    for (let i = 0; i < 8; i++) {
      expect(await statusOf(login(undefined, { body: '{not json' }))).toBe(400)
      expect(await statusOf(login(''))).toBe(400)
    }
    for (let i = 0; i < 5; i++) expect(await statusOf(login('wrong'))).toBe(401)
    expect(await statusOf(login('wrong'))).toBe(429)
  })

  it('an unreadable password store (500) does not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    storeMock.mockImplementation(() => {
      throw new Error('boom')
    })
    for (let i = 0; i < 8; i++) expect(await statusOf(login('wrong'))).toBe(500)
    storeMock.mockReturnValue({})
    expect(await statusOf(login('correct-horse'))).toBe(200)
  })

  it('production without any configured password (500) does not', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ADMIN_PASSWORD', '')
    for (let i = 0; i < 8; i++) expect(await statusOf(login('wrong'))).toBe(500)
    vi.stubEnv('ADMIN_PASSWORD', 'correct-horse')
    expect(await statusOf(login('correct-horse'))).toBe(200)
  })
})

describe('password sources', () => {
  it('compares ADMIN_PASSWORD through the timing-safe compare', async () => {
    expect(await statusOf(login('wrong'))).toBe(401)
    expect(safeEqualMock).toHaveBeenLastCalledWith('wrong', 'correct-horse')
    expect(await statusOf(login('correct-horse'))).toBe(200)
    expect(safeEqualMock).toHaveBeenLastCalledWith('correct-horse', 'correct-horse')
    expect(compareMock).not.toHaveBeenCalled()
  })

  it('a password of another length is rejected, not an error', async () => {
    expect(await statusOf(login('x'))).toBe(401)
    expect(await statusOf(login('correct-horse-and-more'))).toBe(401)
  })

  it('ADMIN_PASSWORD_HASH wins over ADMIN_PASSWORD and goes through bcrypt', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('hash-pass', BCRYPT_COST))
    compareMock.mockClear()
    expect(await statusOf(login('correct-horse'))).toBe(401)
    expect(await statusOf(login('hash-pass'))).toBe(200)
    expect(safeEqualMock).not.toHaveBeenCalled()
  })

  it('the stored hash wins over both environment variables', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('hash-pass', BCRYPT_COST))
    storeMock.mockReturnValue({ hash: await bcrypt.hash('stored-pass', BCRYPT_COST) })
    expect(await statusOf(login('hash-pass'))).toBe(401)
    expect(await statusOf(login('correct-horse'))).toBe(401)
    expect(await statusOf(login('stored-pass'))).toBe(200)
  })

  it('outside production, without any password, the dev default is checked timing-safe', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await statusOf(login('nope'))).toBe(401)
    expect(safeEqualMock).toHaveBeenLastCalledWith('nope', 'admin')
    expect(await statusOf(login('admin'))).toBe(200)
  })

  it('does not log the dev-default warning for a refused (429) request', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 5; i++) await POST(login('nope'))
    expect(warn).toHaveBeenCalledTimes(5)
    await POST(login('nope'))
    expect(warn).toHaveBeenCalledTimes(5)
  })
})

describe('client key: TRUSTED_PROXY_HOPS and X-Forwarded-For', () => {
  // Six wrong attempts from one peer, X-Forwarded-For per attempt from `xff(i)`.
  // Returns whether the sixth was refused, i.e. all six landed in one bucket.
  async function sameBucket(xff: (i: number) => string | undefined, peer: string | null = '10.0.0.1') {
    for (let i = 0; i < 5; i++) await POST(login('wrong', { peer, xff: xff(i) }))
    return (await statusOf(login('wrong', { peer, xff: xff(5) }))) === 429
  }

  describe.each([
    ['absent', undefined],
    ['empty', ''],
    ['0', '0'],
    ['invalid text', 'many'],
    ['negative', '-1'],
    ['fractional', '1.5'],
  ])('TRUSTED_PROXY_HOPS %s -> the header is ignored', (_name, value) => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      if (value === undefined) vi.stubEnv('TRUSTED_PROXY_HOPS', undefined as unknown as string)
      else vi.stubEnv('TRUSTED_PROXY_HOPS', value)
    })

    it('rotating forged X-Forwarded-For values does not escape the bucket', async () => {
      expect(await sameBucket((i) => `203.0.113.${i + 1}`)).toBe(true)
    })

    it('a request without the header lands in the same bucket as one with it', async () => {
      expect(await sameBucket((i) => (i % 2 ? undefined : '203.0.113.9'))).toBe(true)
    })
  })

  it('an invalid value is logged once, however many logins follow', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', 'many')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3; i++) await POST(login('wrong'))
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('TRUSTED_PROXY_HOPS'))).toHaveLength(1)
  })

  describe('TRUSTED_PROXY_HOPS 1', () => {
    beforeEach(() => vi.stubEnv('TRUSTED_PROXY_HOPS', '1'))

    it('a spoofed leftmost entry does not change the key', async () => {
      expect(await sameBucket((i) => `203.0.113.${i + 1}, 198.51.100.50`)).toBe(true)
    })

    it('different rightmost entries are different clients', async () => {
      for (let i = 0; i < 5; i++) await POST(login('wrong', { xff: '198.51.100.50' }))
      expect(await statusOf(login('wrong', { xff: '198.51.100.50' }))).toBe(429)
      expect(await statusOf(login('correct-horse', { xff: '198.51.100.51' }))).toBe(200)
    })

    it('a request without the header is keyed by the peer', async () => {
      expect(await sameBucket(() => undefined)).toBe(true)
      expect(await statusOf(login('correct-horse', { peer: '10.0.0.2', xff: '203.0.113.1' }))).toBe(200)
    })
  })

  describe('TRUSTED_PROXY_HOPS 2', () => {
    beforeEach(() => vi.stubEnv('TRUSTED_PROXY_HOPS', '2'))

    it('keys on the second entry from the right', async () => {
      expect(await sameBucket((i) => `9.9.9.9, 203.0.113.${i + 1}, 192.0.2.1`)).toBe(false)
      expect(await sameBucket((i) => `7.7.7.${i}, 198.51.100.77, 192.0.2.1`, '10.0.0.3')).toBe(true)
    })

    it('fewer entries than hops falls back to the peer, however the header is forged', async () => {
      expect(await sameBucket((i) => `203.0.113.${i + 1}`)).toBe(true)
    })
  })

  it('without a peer address all clients share one bucket, whatever they send', async () => {
    expect(await sameBucket((i) => `203.0.113.${i + 1}`, null)).toBe(true)
    // even a client with a distinct peer-less request is refused: the shared bucket is used up
    expect(await statusOf(login('correct-horse', { peer: null, xff: '198.51.100.9' }))).toBe(429)
  })

  it('without a peer address and hops 1 the trusted entry is still used', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    for (let i = 0; i < 5; i++) await POST(login('wrong', { peer: null, xff: '198.51.100.50' }))
    expect(await statusOf(login('wrong', { peer: null, xff: '198.51.100.50' }))).toBe(429)
    expect(await statusOf(login('correct-horse', { peer: null, xff: '198.51.100.51' }))).toBe(200)
  })
})
