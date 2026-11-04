import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isAuthenticated } from '@/lib/auth'
import { readPasswordConfig, writePasswordConfig, type PasswordConfig } from '@/lib/data-store'
import { getClientKeys, getTrustedProxyHops } from '@/lib/client-ip'
import { passwordChangeRateLimiter } from '@/lib/login-rate-limit'
import { safeEqual } from '@/lib/secure-compare'

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { currentPassword?: string; newPassword?: string; confirmPassword?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { currentPassword, newPassword, confirmPassword } = body

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 })
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 })
  }

  // Verify current password
  let config: PasswordConfig
  try {
    config = readPasswordConfig()
  } catch (err) {
    console.error(`[auth] Could not read the password store: ${err instanceof Error ? err.message : 'unknown error'}`)
    return NextResponse.json({ error: 'Password store unavailable' }, { status: 500 })
  }
  const envHash = process.env.ADMIN_PASSWORD_HASH
  const envPlain = process.env.ADMIN_PASSWORD

  // Pick how the current password is checked first, then limit guessing per
  // client in a key space of its own, so failures here do not use up login
  // attempts and the other way round. Over the limit the password is not
  // looked at at all.
  let verify: (candidate: string) => Promise<boolean>
  if (config.hash) {
    const hash = config.hash
    verify = (candidate) => bcrypt.compare(candidate, hash)
  } else if (envHash) {
    verify = (candidate) => bcrypt.compare(candidate, envHash)
  } else if (envPlain) {
    verify = async (candidate) => safeEqual(candidate, envPlain)
  } else {
    // Dev default
    verify = async (candidate) => safeEqual(candidate, 'admin')
  }

  const client = getClientKeys(req.headers, getTrustedProxyHops())
  const gate = passwordChangeRateLimiter.acquire(client.key, client.parent)
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } },
    )
  }

  if (!(await verify(currentPassword))) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }
  passwordChangeRateLimiter.reset(client.key, client.parent)

  // Hash and save new password
  const newHash = await bcrypt.hash(newPassword, 12)
  writePasswordConfig({ hash: newHash })

  return NextResponse.json({ ok: true })
}
