/**
 * Unit tests for src/app/api/settings/tokens/[id]/route.ts (PATCH, DELETE)
 *
 * Auth is mocked (@/lib/auth) and toggled per test. Data-store is REAL, but
 * DATA_DIR is a module-level const captured at import time (see
 * tests/unit/data-store.test.ts), so the route module (which transitively
 * imports data-store) must be reloaded per test via vi.resetModules() +
 * dynamic import AFTER vi.stubEnv, mirroring tests/unit/agent-ws-handler.test.ts.
 * The vi.mock('@/lib/auth', ...) factory is NOT re-invoked by resetModules,
 * so the statically-imported `isAuthenticated` mock reference stays valid.
 *
 * params is Promise<{ id }> in Next.js 15 route handlers — call handlers as
 * PATCH(req, { params: Promise.resolve({ id }) }).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('@/lib/auth', () => ({
  isAuthenticated: vi.fn(),
}))

import { isAuthenticated } from '@/lib/auth'

const authMock = vi.mocked(isAuthenticated)

function makeRequest(method: 'PATCH' | 'DELETE', body?: unknown | string): NextRequest {
  return new NextRequest('http://localhost/api/settings/tokens/tok-1', {
    method,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

let tmpDir: string
let PATCH: typeof import('@/app/api/settings/tokens/[id]/route').PATCH
let DELETE: typeof import('@/app/api/settings/tokens/[id]/route').DELETE
let readTokens: typeof import('@/lib/data-store').readTokens
let writeTokens: typeof import('@/lib/data-store').writeTokens

const seedToken: import('@/lib/data-store').TokenEntry = {
  id: 'tok-1',
  name: 'original-name',
  tokenHash: '$2b$10$deadbeefdeadbeefdeadbe',
  createdAt: '2026-01-01T00:00:00Z',
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-routes-'))
  vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
  vi.resetModules()
  authMock.mockReset()

  const dataStoreMod = await import('@/lib/data-store')
  readTokens = dataStoreMod.readTokens
  writeTokens = dataStoreMod.writeTokens

  const routeMod = await import('@/app/api/settings/tokens/[id]/route')
  PATCH = routeMod.PATCH
  DELETE = routeMod.DELETE
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('PATCH /api/settings/tokens/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockReturnValue(false)
    const res = await PATCH(makeRequest('PATCH', { name: 'new-name' }), params('tok-1'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 400 on invalid JSON body', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await PATCH(makeRequest('PATCH', 'not json'), params('tok-1'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('returns 404 when the token id does not exist', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await PATCH(makeRequest('PATCH', { name: 'new-name' }), params('does-not-exist'))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Token not found')
  })

  it('renames the token and persists the change: 200', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await PATCH(makeRequest('PATCH', { name: 'renamed-token' }), params('tok-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const stored = readTokens()
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('renamed-token')
    expect(stored[0].tokenHash).toBe(seedToken.tokenHash)
  })

  it('leaves the name unchanged when the body has no name field: 200', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await PATCH(makeRequest('PATCH', {}), params('tok-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const stored = readTokens()
    expect(stored[0].name).toBe(seedToken.name)
  })
})

describe('DELETE /api/settings/tokens/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockReturnValue(false)
    const res = await DELETE(makeRequest('DELETE'), params('tok-1'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 404 when the token id does not exist', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await DELETE(makeRequest('DELETE'), params('does-not-exist'))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Token not found')
    expect(readTokens()).toHaveLength(1)
  })

  it('deletes the token and persists the change: 200', async () => {
    authMock.mockReturnValue(true)
    writeTokens([seedToken])
    const res = await DELETE(makeRequest('DELETE'), params('tok-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
    expect(readTokens()).toEqual([])
  })
})
