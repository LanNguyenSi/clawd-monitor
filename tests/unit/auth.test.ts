/**
 * Unit tests for src/lib/auth.ts
 *
 * The module caches JWT_SECRET on first use (_jwtSecret module-level var).
 * We reload the module via vi.resetModules() once in beforeAll so the
 * test-controlled JWT_SECRET is picked up cleanly.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'

const JWT_SECRET = 'test-jwt-secret-for-auth-unit-tests'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Minimal NextRequest stand-in — avoids Next.js runtime dependency in tests. */
function mockReq(opts: { authHeader?: string; cookieToken?: string }): NextRequest {
  return {
    headers: {
      get(key: string): string | null {
        if (key.toLowerCase() === 'authorization') return opts.authHeader ?? null
        return null
      },
    },
    cookies: {
      get(key: string): { value: string } | undefined {
        if (key === 'token' && opts.cookieToken != null) return { value: opts.cookieToken }
        return undefined
      },
    },
  } as unknown as NextRequest
}

// ── module-under-test (loaded with controlled JWT_SECRET) ─────────────────────

let generateToken: (payload: { sub: string }) => string
let verifyToken: (token: string) => { sub: string; iat?: number; exp?: number } | null
let extractToken: (req: NextRequest) => string | null
let isAuthenticated: (req: NextRequest) => boolean

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', JWT_SECRET)
  vi.resetModules()
  const mod = await import('@/lib/auth')
  generateToken = mod.generateToken
  verifyToken = mod.verifyToken
  extractToken = mod.extractToken
  isAuthenticated = mod.isAuthenticated
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// ── generateToken / verifyToken ───────────────────────────────────────────────

describe('generateToken + verifyToken', () => {
  it('round-trips a token with the correct sub', () => {
    const token = generateToken({ sub: 'user-abc' })
    expect(typeof token).toBe('string')

    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-abc')
  })

  it('includes iat and exp claims', () => {
    const token = generateToken({ sub: 'user-abc' })
    const payload = verifyToken(token)
    expect(typeof payload!.iat).toBe('number')
    expect(typeof payload!.exp).toBe('number')
    expect(payload!.exp!).toBeGreaterThan(payload!.iat!)
  })

  it('returns null for a token signed with a different secret (tampered)', () => {
    const tampered = jwt.sign({ sub: 'user-abc' }, 'wrong-secret')
    expect(verifyToken(tampered)).toBeNull()
  })

  it('returns null when the signature is mutated', () => {
    const token = generateToken({ sub: 'user-xyz' })
    const parts = token.split('.')
    // Flip the last character of the signature
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A')
    expect(verifyToken(parts.join('.'))).toBeNull()
  })

  it('returns null for an expired token', () => {
    // Build a token with exp set 60 s in the past using the same secret
    const expiredToken = jwt.sign(
      { sub: 'user-expired', exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_SECRET
    )
    expect(verifyToken(expiredToken)).toBeNull()
  })

  it('returns null for a completely garbage string', () => {
    expect(verifyToken('not.a.jwt')).toBeNull()
  })
})

// ── extractToken ──────────────────────────────────────────────────────────────

describe('extractToken', () => {
  it('extracts the token from the Authorization: Bearer header', () => {
    const req = mockReq({ authHeader: 'Bearer my-header-token' })
    expect(extractToken(req)).toBe('my-header-token')
  })

  it('extracts the token from the cookie when no Authorization header', () => {
    const req = mockReq({ cookieToken: 'my-cookie-token' })
    expect(extractToken(req)).toBe('my-cookie-token')
  })

  it('prefers the Authorization header over the cookie', () => {
    const req = mockReq({ authHeader: 'Bearer header-wins', cookieToken: 'cookie-loses' })
    expect(extractToken(req)).toBe('header-wins')
  })

  it('returns null when neither header nor cookie is present', () => {
    expect(extractToken(mockReq({}))).toBeNull()
  })

  it('returns null when Authorization header has wrong prefix', () => {
    const req = mockReq({ authHeader: 'Token my-token' })
    // 'Token ' does not match 'Bearer ' prefix
    expect(extractToken(req)).toBeNull()
  })
})

// ── isAuthenticated ───────────────────────────────────────────────────────────

describe('isAuthenticated', () => {
  it('returns true for a request carrying a valid token', () => {
    const token = generateToken({ sub: 'user-auth' })
    const req = mockReq({ authHeader: `Bearer ${token}` })
    expect(isAuthenticated(req)).toBe(true)
  })

  it('returns false for a request with no token', () => {
    expect(isAuthenticated(mockReq({}))).toBe(false)
  })

  it('returns false for a request with an expired token', () => {
    const expired = jwt.sign(
      { sub: 'user-expired', exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_SECRET
    )
    expect(isAuthenticated(mockReq({ authHeader: `Bearer ${expired}` }))).toBe(false)
  })

  it('returns false for a tampered token', () => {
    const token = generateToken({ sub: 'user-tampered' })
    const parts = token.split('.')
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A')
    expect(isAuthenticated(mockReq({ authHeader: `Bearer ${parts.join('.')}` }))).toBe(false)
  })
})

// ── getJwtSecret – production guard (lines 11-12 of auth.ts) ─────────────────
//
// When JWT_SECRET is absent in production the module must throw immediately.
// _jwtSecret is memoised, so a vi.resetModules() + fresh import is required.

describe('getJwtSecret – production: throws when JWT_SECRET is absent', () => {
  let prodGenerateToken: (payload: { sub: string }) => string

  beforeAll(async () => {
    // Set production env WITHOUT a JWT_SECRET (empty string → falsy).
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', '')
    vi.resetModules()
    const mod = await import('@/lib/auth')
    prodGenerateToken = mod.generateToken
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('throws with the expected message when JWT_SECRET is absent in production', () => {
    expect(() => prodGenerateToken({ sub: 'u' }))
      .toThrow(/JWT_SECRET environment variable is required in production/)
  })
})

// ── getJwtSecret – dev default (lines 14-16 of auth.ts) ──────────────────────
//
// When JWT_SECRET is absent outside production the module uses the hardcoded
// dev fallback secret and does NOT throw. generateToken + verifyToken must
// still round-trip.

describe('getJwtSecret – non-production: uses dev default when JWT_SECRET is absent', () => {
  let devGenerateToken: (payload: { sub: string }) => string
  let devVerifyToken: (token: string) => { sub: string } | null

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test') // already the vitest default, but explicit is clearer
    vi.stubEnv('JWT_SECRET', '')
    vi.resetModules()
    const mod = await import('@/lib/auth')
    devGenerateToken = mod.generateToken
    devVerifyToken = mod.verifyToken as (token: string) => { sub: string } | null
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does not throw and generates a token with the dev default secret', () => {
    expect(() => devGenerateToken({ sub: 'dev-user' })).not.toThrow()
  })

  it('verifyToken round-trips a token generated with the dev default secret', () => {
    const token = devGenerateToken({ sub: 'dev-user' })
    const payload = devVerifyToken(token)
    expect(payload?.sub).toBe('dev-user')
  })
})
