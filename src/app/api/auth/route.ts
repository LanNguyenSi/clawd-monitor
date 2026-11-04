import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { generateToken, isAuthenticated } from '@/lib/auth'
import { readPasswordConfig, type PasswordConfig } from '@/lib/data-store'
import { getClientKeys, getTrustedProxyHops } from '@/lib/client-ip'
import { loginRateLimiter } from '@/lib/login-rate-limit'
import { safeEqual } from '@/lib/secure-compare'

export async function GET(req: NextRequest) {
  return NextResponse.json({ authenticated: isAuthenticated(req) })
}

export async function POST(req: NextRequest) {
  let body: { password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { password } = body
  if (!password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  // Check persisted password (UI change-password) first, then env vars, then dev default
  // An unreadable password.json must not fall through to the env password: the
  // persisted one may be a password the operator changed away from it.
  let persisted: PasswordConfig
  try {
    persisted = readPasswordConfig()
  } catch (err) {
    console.error(`[auth] Could not read the password store: ${err instanceof Error ? err.message : 'unknown error'}`)
    return NextResponse.json({ error: 'Password store unavailable' }, { status: 500 })
  }
  const envHash = process.env.ADMIN_PASSWORD_HASH
  const envPlain = process.env.ADMIN_PASSWORD

  // Pick how the password is checked first, so a store or config error answers
  // 500 without using up one of the client's attempts.
  let verify: (candidate: string) => Promise<boolean>
  if (persisted.hash) {
    const hash = persisted.hash
    verify = (candidate) => bcrypt.compare(candidate, hash)
  } else if (envHash) {
    verify = (candidate) => bcrypt.compare(candidate, envHash)
  } else if (envPlain) {
    verify = async (candidate) => safeEqual(candidate, envPlain)
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'No admin password configured' }, { status: 500 })
  } else {
    // Dev default — no password configured
    verify = async (candidate) => {
      console.warn('[auth] No password configured — using insecure dev default. Do NOT use in production.')
      return safeEqual(candidate, 'admin')
    }
  }

  // Limit guessing per client. Over the limit the password is not looked at at
  // all, so the right password does not get through either until the window ends.
  const client = getClientKeys(req.headers, getTrustedProxyHops())
  const gate = loginRateLimiter.acquire(client.key, client.parent)
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Too many failed login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } },
    )
  }

  if (!(await verify(password))) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }
  loginRateLimiter.reset(client.key, client.parent)
  // Only here, after the password was verified: this key keeps a way in while a flood fills the limiter.
  loginRateLimiter.recordSuccess(client.key, client.parent)

  const token = generateToken({ sub: 'admin' })

  const response = NextResponse.json({ ok: true })
  response.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  })

  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
