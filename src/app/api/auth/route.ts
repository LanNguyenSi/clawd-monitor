import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { generateToken, isAuthenticated } from '@/lib/auth'
import { readPasswordConfig, type PasswordConfig } from '@/lib/data-store'

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

  let valid = false
  if (persisted.hash) {
    valid = await bcrypt.compare(password, persisted.hash)
  } else if (envHash) {
    valid = await bcrypt.compare(password, envHash)
  } else if (envPlain) {
    valid = password === envPlain
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'No admin password configured' }, { status: 500 })
  } else {
    // Dev default — no password configured
    console.warn('[auth] No password configured — using insecure dev default. Do NOT use in production.')
    valid = password === 'admin'
  }

  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

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
