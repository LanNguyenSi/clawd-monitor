import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'

const JWT_EXPIRES = '24h'

// One rule for JWT_SECRET, shared by the production startup check in
// server.ts and getJwtSecret() below. The minimum counts the raw value
// (no trimming); a value that is empty or only whitespace counts as absent.
export const JWT_SECRET_MIN_LENGTH = 32

// Returns a message naming the variable and the minimum, never the value,
// or undefined when the secret satisfies the rule.
export function jwtSecretProblem(secret: string | undefined): string | undefined {
  if (secret === undefined || secret.trim() === '') {
    return 'JWT_SECRET environment variable is required in production'
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    return `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters in production (current length ${secret.length})`
  }
  return undefined
}

let _jwtSecret: string | undefined
function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret
  const secret = process.env.JWT_SECRET
  const problem = jwtSecretProblem(secret)
  if (problem) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${problem}. Generate one with: openssl rand -hex 32`)
    }
    if (secret && secret.trim() !== '') {
      console.warn(`[auth] ${problem}; accepted in development, refused in production`)
      _jwtSecret = secret
      return _jwtSecret
    }
    console.warn('[auth] JWT_SECRET not set — using insecure dev default. Do NOT use in production.')
    _jwtSecret = 'dev-secret-change-in-production' // pragma: allowlist secret
    return _jwtSecret
  }
  // jwtSecretProblem() returned undefined, so secret is a non-empty string here.
  _jwtSecret = secret as string
  return _jwtSecret
}

export interface TokenPayload {
  sub: string
  iat?: number
  exp?: number
}

export function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as TokenPayload
  } catch {
    return null
  }
}

export function extractToken(req: NextRequest): string | null {
  // Check Authorization header first
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // Check cookie
  const cookie = req.cookies.get('token')
  if (cookie) return cookie.value

  return null
}

export function isAuthenticated(req: NextRequest): boolean {
  const token = extractToken(req)
  if (!token) return false
  return verifyToken(token) !== null
}
