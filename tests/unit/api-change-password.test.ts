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

  it('returns 400 when newPassword and confirmPassword do not match', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'admin', newPassword: 'newpassword', confirmPassword: 'different' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Passwords do not match')
  })

  it('returns 401 when currentPassword does not match the stored bcrypt hash', async () => {
    authMock.mockReturnValue(true)
    writePasswordConfig({ hash: await bcrypt.hash('oldpass', 12) })
    const res = await POST(makeRequest({ currentPassword: 'wrongpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Current password is incorrect')
  })

  it('returns 200 and persists a new bcrypt hash when currentPassword matches the stored hash', async () => {
    authMock.mockReturnValue(true)
    writePasswordConfig({ hash: await bcrypt.hash('oldpass', 12) })
    const res = await POST(makeRequest({ currentPassword: 'oldpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const config = readPasswordConfig()
    expect(config.hash).toBeTruthy()
    expect(config.hash).not.toBe('newpassword')
    await expect(bcrypt.compare('newpassword', config.hash!)).resolves.toBe(true)
    await expect(bcrypt.compare('oldpass', config.hash!)).resolves.toBe(false)
  })

  it('verifies currentPassword against ADMIN_PASSWORD_HASH env when no stored config hash exists', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('envhashpass', 12))
    vi.resetModules()
    const routeMod = await import('@/app/api/auth/change-password/route')
    const res = await routeMod.POST(makeRequest({ currentPassword: 'envhashpass', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(200)
  })

  it('rejects a wrong currentPassword when only ADMIN_PASSWORD_HASH env is set', async () => {
    authMock.mockReturnValue(true)
    vi.stubEnv('ADMIN_PASSWORD_HASH', await bcrypt.hash('envhashpass', 12))
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
  })

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
  })

  it('rejects a wrong currentPassword against the dev default when nothing is configured', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makeRequest({ currentPassword: 'notadmin', newPassword: 'newpassword', confirmPassword: 'newpassword' }))
    expect(res.status).toBe(401)
  })
})
