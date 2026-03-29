import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { generateToken } from '@/lib/auth'

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

  const hash = process.env.ADMIN_PASSWORD_HASH
  const adminPassword = process.env.ADMIN_PASSWORD // plaintext fallback

  if (!hash && !adminPassword) {
    return NextResponse.json({ error: 'Server misconfigured — set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH' }, { status: 500 })
  }

  if (hash) {
    const valid = await bcrypt.compare(password, hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
  } else if (adminPassword) {
    if (password !== adminPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
  }

  const token = generateToken({ sub: 'admin' })

  const response = NextResponse.json({ token })
  response.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24h
    path: '/',
  })

  return response
}
