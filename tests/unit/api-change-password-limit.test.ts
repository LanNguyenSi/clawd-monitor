/**
 * Unit tests for the attempt limit on POST /api/auth/change-password: the
 * current-password check is limited per client in a key space of its own, the
 * plain password is compared in constant time, and nothing here uses up login
 * attempts (or the other way round). The rest of the route is covered by
 * api-change-password.test.ts.
 *
 * Data store, session check, secure-compare and bcrypt are wrapped or mocked;
 * the limiter modules are re-imported per test (vi.resetModules) so every test
 * starts with empty limiters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn(), generateToken: vi.fn(() => 'token') }))
vi.mock('@/lib/data-store', () => ({
  readPasswordConfig: vi.fn(() => ({})),
  writePasswordConfig: vi.fn(),
}))
vi.mock('@/lib/secure-compare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/secure-compare')>()
  return { safeEqual: vi.fn(actual.safeEqual) }
})
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('bcryptjs') }>()
  return {
    default: {
      ...actual.default,
      compare: vi.fn(actual.default.compare),
      hash: vi.fn(async () => 'new-hash'),
    },
  }
})

import { isAuthenticated } from '@/lib/auth'
import { readPasswordConfig, writePasswordConfig } from '@/lib/data-store'
import { safeEqual } from '@/lib/secure-compare'
import { PEER_ADDR_HEADER } from '@/lib/client-ip'

const authMock = vi.mocked(isAuthenticated)
const storeMock = vi.mocked(readPasswordConfig)
const writeMock = vi.mocked(writePasswordConfig)
const safeEqualMock = vi.mocked(safeEqual)
const compareMock = vi.mocked(bcrypt.compare)

const WINDOW_MS = 15 * 60 * 1000

let change: typeof import('@/app/api/auth/change-password/route').POST
let loginPost: typeof import('@/app/api/auth/route').POST

function req(
  url: string,
  body: unknown,
  opts: { peer?: string | null; xff?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {}
  const peer = opts.peer === undefined ? '10.0.0.1' : opts.peer
  if (peer !== null) headers[PEER_ADDR_HEADER] = peer
  if (opts.xff !== undefined) headers['x-forwarded-for'] = opts.xff
  return new NextRequest(`http://localhost${url}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const changeReq = (current: string, opts: { peer?: string | null; xff?: string } = {}) =>
  req('/api/auth/change-password', { currentPassword: current, newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' }, opts)

const loginReq = (password: string, opts: { peer?: string | null } = {}) => req('/api/auth', { password }, opts)

const statusOf = async (r: NextRequest) => (await change(r)).status

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  vi.stubEnv('ADMIN_PASSWORD_HASH', '')
  vi.stubEnv('ADMIN_PASSWORD', 'correct-horse')
  vi.stubEnv('TRUSTED_PROXY_HOPS', '')
  authMock.mockReset().mockReturnValue(true)
  storeMock.mockReset().mockReturnValue({})
  writeMock.mockReset()
  safeEqualMock.mockReset()
  compareMock.mockReset()
  vi.resetModules()
  change = (await import('@/app/api/auth/change-password/route')).POST
  loginPost = (await import('@/app/api/auth/route')).POST
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('limit and lockout', () => {
  it('answers 401 for five wrong current passwords and 429 for the sixth', async () => {
    for (let i = 0; i < 5; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    const res = await change(changeReq('wrong'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe(String(WINDOW_MS / 1000))
    expect(await res.json()).toEqual({ error: 'Too many failed attempts. Try again later.' })
  })

  it('does not check the password once the limit is reached, and writes nothing', async () => {
    for (let i = 0; i < 5; i++) await change(changeReq('wrong'))
    expect(safeEqualMock).toHaveBeenCalledTimes(5)
    expect(await statusOf(changeReq('correct-horse'))).toBe(429)
    expect(safeEqualMock).toHaveBeenCalledTimes(5)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('does not call bcrypt either when the limit is reached (stored hash)', async () => {
    storeMock.mockReturnValue({ hash: await bcrypt.hash('x', 4) })
    compareMock.mockResolvedValue(false as never)
    for (let i = 0; i < 5; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    expect(compareMock).toHaveBeenCalledTimes(5)
    expect(await statusOf(changeReq('anything'))).toBe(429)
    expect(compareMock).toHaveBeenCalledTimes(5)
  })

  it('lets the client try again when the window has passed', async () => {
    for (let i = 0; i < 5; i++) await change(changeReq('wrong'))
    vi.advanceTimersByTime(WINDOW_MS - 1)
    expect(await statusOf(changeReq('correct-horse'))).toBe(429)
    vi.advanceTimersByTime(1)
    expect(await statusOf(changeReq('correct-horse'))).toBe(200)
  })

  it('keeps clients apart', async () => {
    for (let i = 0; i < 5; i++) await change(changeReq('wrong', { peer: '10.0.0.1' }))
    expect(await statusOf(changeReq('wrong', { peer: '10.0.0.1' }))).toBe(429)
    expect(await statusOf(changeReq('correct-horse', { peer: '10.0.0.2' }))).toBe(200)
  })

  it('a forged X-Forwarded-For does not escape the bucket (TRUSTED_PROXY_HOPS unset)', async () => {
    for (let i = 0; i < 5; i++) await change(changeReq('wrong', { xff: `203.0.113.${i}` }))
    expect(await statusOf(changeReq('wrong', { xff: '198.51.100.1' }))).toBe(429)
  })

  it('with TRUSTED_PROXY_HOPS=1 the last X-Forwarded-For entry is the client', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    for (let i = 0; i < 5; i++) await change(changeReq('wrong', { xff: `1.1.1.${i}, 198.51.100.50` }))
    expect(await statusOf(changeReq('wrong', { xff: '9.9.9.9, 198.51.100.50' }))).toBe(429)
    expect(await statusOf(changeReq('correct-horse', { xff: '9.9.9.9, 198.51.100.51' }))).toBe(200)
  })

  it('the /64s of one IPv6 /48 share a budget of 50', async () => {
    for (let i = 0; i < 50; i++) {
      expect(await statusOf(changeReq('wrong', { peer: `2001:db8:1:${i.toString(16)}::1` }))).toBe(401)
    }
    expect(await statusOf(changeReq('correct-horse', { peer: '2001:db8:1:ffff::1' }))).toBe(429)
  })
})

describe('success', () => {
  it('resets the client: four failures, a change, then a full budget again', async () => {
    for (let i = 0; i < 4; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    expect(await statusOf(changeReq('correct-horse'))).toBe(200)
    expect(writeMock).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    expect(await statusOf(changeReq('wrong'))).toBe(429)
  })
})

describe('success on IPv6', () => {
  it('resets the /48 as well', async () => {
    for (let i = 0; i < 49; i++) await change(changeReq('wrong', { peer: `2001:db8:1:${i.toString(16)}::1` }))
    expect(await statusOf(changeReq('correct-horse', { peer: '2001:db8:1:ff::1' }))).toBe(200)
    for (let i = 0; i < 49; i++) {
      expect(await statusOf(changeReq('wrong', { peer: `2001:db8:1:${(i + 100).toString(16)}::1` }))).toBe(401)
    }
  })
})

describe('which requests use up an attempt', () => {
  it('unauthenticated, invalid and store-error requests do not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockReturnValue(false)
    for (let i = 0; i < 8; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    authMock.mockReturnValue(true)
    for (let i = 0; i < 8; i++) expect(await statusOf(req('/api/auth/change-password', { currentPassword: 'wrong' }))).toBe(400)
    for (let i = 0; i < 8; i++) expect(await statusOf(req('/api/auth/change-password', '{nope'))).toBe(400)
    storeMock.mockImplementation(() => {
      throw new Error('boom')
    })
    for (let i = 0; i < 8; i++) expect(await statusOf(changeReq('wrong'))).toBe(500)
    storeMock.mockReturnValue({})
    for (let i = 0; i < 5; i++) expect(await statusOf(changeReq('wrong'))).toBe(401)
    expect(await statusOf(changeReq('wrong'))).toBe(429)
  })
})

describe('separate from the login limiter', () => {
  it('five wrong change-password attempts do not lock login', async () => {
    for (let i = 0; i < 6; i++) await change(changeReq('wrong'))
    expect((await loginPost(loginReq('correct-horse'))).status).toBe(200)
  })

  it('five wrong logins do not lock change-password', async () => {
    for (let i = 0; i < 6; i++) await loginPost(loginReq('wrong'))
    expect((await loginPost(loginReq('correct-horse'))).status).toBe(429)
    expect(await statusOf(changeReq('correct-horse'))).toBe(200)
  })

  it('a successful change does not reset the login count', async () => {
    for (let i = 0; i < 4; i++) await loginPost(loginReq('wrong'))
    expect(await statusOf(changeReq('correct-horse'))).toBe(200)
    expect((await loginPost(loginReq('wrong'))).status).toBe(401) // 5th
    expect((await loginPost(loginReq('wrong'))).status).toBe(429)
  })
})

describe('constant-time compare', () => {
  it('compares ADMIN_PASSWORD through safeEqual', async () => {
    expect(await statusOf(changeReq('wrong'))).toBe(401)
    expect(safeEqualMock).toHaveBeenLastCalledWith('wrong', 'correct-horse')
  })

  it('compares the development default through safeEqual', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(await statusOf(changeReq('nope'))).toBe(401)
    expect(safeEqualMock).toHaveBeenLastCalledWith('nope', 'admin')
    expect(await statusOf(changeReq('admin'))).toBe(200)
  })

  it('ADMIN_PASSWORD_HASH goes through bcrypt, not safeEqual', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', 'some-hash')
    compareMock.mockResolvedValue(true as never)
    expect(await statusOf(changeReq('whatever'))).toBe(200)
    expect(compareMock).toHaveBeenCalledWith('whatever', 'some-hash')
    expect(safeEqualMock).not.toHaveBeenCalled()
  })

  it('the stored hash wins over the environment', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', 'env-hash')
    storeMock.mockReturnValue({ hash: 'stored-hash' })
    compareMock.mockResolvedValue(true as never)
    await change(changeReq('whatever'))
    expect(compareMock).toHaveBeenCalledWith('whatever', 'stored-hash')
  })
})
