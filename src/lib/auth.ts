import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'

const JWT_EXPIRES = '24h'

let _jwtSecret: string | undefined
function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret
  const secret = process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production')
    }
    console.warn('[auth] JWT_SECRET not set — using insecure dev default. Do NOT use in production.')
    _jwtSecret = 'dev-secret-change-in-production'
    return _jwtSecret
  }
  _jwtSecret = secret
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
