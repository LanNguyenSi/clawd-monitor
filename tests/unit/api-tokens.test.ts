/**
 * Unit tests for src/app/api/settings/tokens/route.ts (GET, POST)
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

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/settings/tokens', { method: 'GET' })
}

function makePostRequest(body: unknown | string): NextRequest {
  return new NextRequest('http://localhost/api/settings/tokens', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

let tmpDir: string
let GET: typeof import('@/app/api/settings/tokens/route').GET
let POST: typeof import('@/app/api/settings/tokens/route').POST
let readTokens: typeof import('@/lib/data-store').readTokens
let writeTokens: typeof import('@/lib/data-store').writeTokens

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-routes-'))
  vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
  vi.resetModules()
  authMock.mockReset()

  const dataStoreMod = await import('@/lib/data-store')
  readTokens = dataStoreMod.readTokens
  writeTokens = dataStoreMod.writeTokens

  const routeMod = await import('@/app/api/settings/tokens/route')
  GET = routeMod.GET
  POST = routeMod.POST
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/settings/tokens', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockReturnValue(false)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns the token list mapped to id/name/createdAt/lastUsedAt, without tokenHash', async () => {
    authMock.mockReturnValue(true)
    writeTokens([
      { id: 'tok-1', name: 'ci-token', tokenHash: '$2b$10$deadbeefdeadbeefdeadbe', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-02T00:00:00Z' },
    ])
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tokens).toEqual([
      { id: 'tok-1', name: 'ci-token', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-02T00:00:00Z' },
    ])
    // security assertion: the response must NOT contain tokenHash anywhere
    expect(JSON.stringify(json)).not.toContain('tokenHash')
    expect(json.tokens[0].tokenHash).toBeUndefined()
  })

  it('returns an empty list when no tokens exist', async () => {
    authMock.mockReturnValue(true)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tokens).toEqual([])
  })
})

describe('POST /api/settings/tokens', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockReturnValue(false)
    const res = await POST(makePostRequest({ name: 'my-token' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 400 on invalid JSON body', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makePostRequest('not json'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('returns 400 when name is missing', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('name is required')
  })

  it('returns 400 when name is whitespace-only', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makePostRequest({ name: '   ' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('name is required')
  })

  it('creates a token: 201, returns raw token once, persists a bcrypt hash (not the raw token)', async () => {
    authMock.mockReturnValue(true)
    const res = await POST(makePostRequest({ name: '  my-token  ' }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.name).toBe('my-token')
    expect(typeof json.token).toBe('string')
    expect(json.token.length).toBeGreaterThan(0)
    expect(typeof json.id).toBe('string')

    const stored = readTokens()
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(json.id)
    expect(stored[0].name).toBe('my-token')
    // security assertions: hashed at rest, raw token never equals the stored hash
    expect(stored[0].tokenHash).toBeTruthy()
    expect(stored[0].tokenHash).not.toBe(json.token)
    await expect(bcrypt.compare(json.token, stored[0].tokenHash)).resolves.toBe(true)
  })

  it('appends to existing tokens: a second create preserves the first (read-modify-write)', async () => {
    authMock.mockReturnValue(true)
    const first = await (await POST(makePostRequest({ name: 'first' }))).json()
    const second = await (await POST(makePostRequest({ name: 'second' }))).json()

    const stored = readTokens()
    expect(stored).toHaveLength(2)
    const ids = stored.map((t) => t.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    expect(stored.map((t) => t.name)).toEqual(['first', 'second'])
  })
})
