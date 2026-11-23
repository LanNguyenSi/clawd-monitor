/**
 * Unit tests for src/app/api/auth/change-password/route.ts
 *
 * Auth is mocked (@/lib/auth) and toggled per test. Data-store is REAL, but
 * DATA_DIR is a module-level const captured at import time (see
 * tests/unit/data-store.test.ts), so the route module (which transitively
 * imports data-store) must be reloaded per test via vi.resetModules() +
 * dynamic import AFTER vi.stubEnv, mirroring tests/unit/agent-ws-handler.test.ts.
 * The vi.mock('@/lib/auth', ...) factory is NOT re-invoked by resetModules,
 * so the statically-imported `isAuthenticated` mock reference stays valid.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/auth', () => ({
  isAuthenticated: vi.fn(),
}))

import { isAuthenticated } from '@/lib/auth'

const authMock = vi.mocked(isAuthenticated)

// Fixture hashes use the minimum practical bcrypt cost: bcryptjs is pure
// JavaScript, and cost 12 fixtures (4096 rounds each) made these tests time
// out under the full coverage run. The cost is encoded in the hash, so
// bcrypt.compare in the route verifies a cost-4 hash exactly like a cost-12
// one; the behaviour under test does not depend on the cost.
const TEST_BCRYPT_COST = 4

// Successful password changes run the route's own cost-12 bcrypt.hash for
// the new password, which is slow under coverage instrumentation; give
// those tests an explicit budget instead of vitest's 5 s default.
const ROUTE_HASH_TIMEOUT_MS = 20_000

function makeRequest(body: unknown | string): NextRequest {
  return new NextRequest('http://localhost/api/auth/change-password', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

let tmpDir: string
let POST: typeof import('@/app/api/auth/change-password/route').POST
let writePasswordConfig: typeof import('@/lib/data-store').writePasswordConfig
let readPasswordConfig: typeof import('@/lib/data-store').readPasswordConfig

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-routes-'))
  vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
  vi.stubEnv('ADMIN_PASSWORD_HASH', '')
  vi.stubEnv('ADMIN_PASSWORD', '')
  vi.resetModules()
  authMock.mockReset()

  const dataStoreMod = await import('@/lib/data-store')
  writePasswordConfig = dataStoreMod.writePasswordConfig
  readPasswordConfig = dataStoreMod.readPasswordConfig

  const routeMod = await import('@/app/api/auth/change-password/route')
  POST = routeMod.POST
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('POST /api/auth/change-password', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockReturnValue(false)
    const res = await POST(makeRequest({ currentPassword: 'a', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 400 on invalid JSON body', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest('not json'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('returns 400 when currentPassword is missing', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('All fields required')
  })

  it('returns 400 when newPassword is missing', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('All fields required')
  })

  it('returns 400 when confirmPassword is missing', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: 'newpassword' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('All fields required')
  })

  it('returns 400 when newPassword is shorter than 8 characters', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: 'short', confirmPassword: 'short' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Password must be at least 8 characters')
  })

  it('returns 400 when newPassword is not a string', async () => {
    authMock.mockReturnValue(true)
    for (const bad of [12345678, ['abcdefgh'], { length: 20 }, true]) {
      const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: bad, confirmPassword: bad }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Password must be at least 8 characters')
    }
    expect(readPasswordConfig().hash).toBeUndefined()
  })

  describe('72-byte limit (bcrypt only uses the first 72 bytes)', () => {
    const post = (newPassword: string) =>
      POST(makeRequest({ currentPassword: 'oldpass', newPassword, confirmPassword: newPassword }))

    beforeEach(async () => {
      authMock.mockReturnValue(true)
      writePasswordConfig({ hash: await bcrypt.hash('oldpass', TEST_BCRYPT_COST) })
    })

    it('accepts 72 ASCII bytes and the stored hash verifies it', async () => {
      const pw = 'a'.repeat(72)
      const res = await post(pw)
      expect(res.status).toBe(200)
      await expect(bcrypt.compare(pw, readPasswordConfig().hash!)).resolves.toBe(true)
    }, ROUTE_HASH_TIMEOUT_MS)

    it('refuses 73 ASCII bytes with a message naming the byte limit, and keeps the old password', async () => {
      const before = readPasswordConfig().hash
      const res = await post('a'.repeat(73))
      expect(res.status).toBe(400)
      const { error } = await res.json()
      expect(error).toContain('72 bytes')
      expect(error).toContain('2 to 4 bytes')
      expect(readPasswordConfig().hash).toBe(before)
    })

    it('counts bytes, not characters: 24 three-byte characters (72 bytes) are accepted and verify', async () => {
      const pw = '\u20ac'.repeat(24)
      expect(pw.length).toBe(24)
      expect(Buffer.byteLength(pw, 'utf8')).toBe(72)
      const res = await post(pw)
      expect(res.status).toBe(200)
      await expect(bcrypt.compare(pw, readPasswordConfig().hash!)).resolves.toBe(true)
    }, ROUTE_HASH_TIMEOUT_MS)

    it('refuses 25 three-byte characters (75 bytes, only 25 characters)', async () => {
      const pw = '\u20ac'.repeat(25)
      expect(pw.length).toBe(25)
      const res = await post(pw)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('72 bytes')
    })

    it('counts a surrogate pair (4 bytes, 2 UTF-16 units) as 4 bytes: 18 emoji are 72 bytes, 19 are not', async () => {
      const ok = await post('\u{1F600}'.repeat(18))
      expect(ok.status).toBe(200)
      const tooLong = await post('\u{1F600}'.repeat(19))
      expect(tooLong.status).toBe(400)
    }, ROUTE_HASH_TIMEOUT_MS)

    it('checks the length of 8 characters before the byte limit: 7 characters stay a short-password error', async () => {
      const res = await post('abcdefg')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Password must be at least 8 characters')
    })
  })

  it('returns 400 when newPassword and confirmPassword do not match', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: 'newpassword', confirmPassword: 'different' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Passwords do not match')
  })

  it('returns 401 when currentPassword does not match the stored bcrypt hash', async () => {
    authMock.mockReturnValue(true)
    writePasswordConfig({ hash: await bcrypt.hash('oldpass', TEST_BCRYPT_COST) })
    const res = await POST(makeRequest({ currentPassword: 'wrongpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Current password is incorrect')
  })

  it('returns 200 and persists a new bcrypt hash when currentPassword matches the stored hash', async () => {
    authMock.mockReturnValue(true)
    writePasswordConfig({ hash: await bcrypt.hash('oldpass', TEST_BCRYPT_COST) })
    const res = await POST(makeRequest({ currentPassword: 'oldpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const config = readPasswordConfig()
    expect(config.hash).toBeTruthy()
    expect(config.hash).not.toBe('newpassword')
    await expect(bcrypt.compare('newpassword', config.hash!)).resolves.toBe(true)
    await expect(bcrypt.compare('oldpass', config.hash!)).resolves.toBe(false)
    // The route, unlike the fixtures above, must persist a full-cost hash.
    expect(bcrypt.getRounds(config.hash!)).toBe(12)
  }, ROUTE_HASH_TIMEOUT_MS)

  it('verifies currentPassword against ADMIN_PASSWORD_HASH env when no stored config hash exists', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('envhashpass', TEST_BCRYPT_COST))
    vi.resetModules()
    const routeMod = await import('@/app/api/auth/change-password/route')
    const res = await routeMod.POST(makeRequest({ currentPassword: 'envhashpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
  }, ROUTE_HASH_TIMEOUT_MS)

  it('rejects a wrong currentPassword when only ADMIN_PASSWORD_HASH env is set', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('envhashpass', TEST_BCRYPT_COST))
    vi.resetModules()
    const routeMod = await import('@/app/api/auth/change-password/route')
    const res = await routeMod.POST(makeRequest({ currentPassword: 'wrong', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
  })

  it('verifies currentPassword against plaintext ADMIN_PASSWORD env when no config hash or ADMIN_PASSWORD_HASH exists', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD', 'plainenvpass')
    vi.resetModules()
    const routeMod = await import('@/app/api/auth/change-password/route')
    const res = await routeMod.POST(makeRequest({ currentPassword: 'plainenvpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
  }, ROUTE_HASH_TIMEOUT_MS)

  it('rejects a wrong currentPassword when only plaintext ADMIN_PASSWORD env is set', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD', 'plainenvpass')
    vi.resetModules()
    const routeMod = await import('@/app/api/auth/change-password/route')
    const res = await routeMod.POST(makeRequest({ currentPassword: 'wrong', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
  })

  it('falls back to the dev default "admin" when no config hash and no env vars are set', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
  }, ROUTE_HASH_TIMEOUT_MS)

  it('rejects a wrong currentPassword against the dev default when nothing is configured', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'notadmin', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
  })
})
