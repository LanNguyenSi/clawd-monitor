import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { generateToken, isAuthenticated } from '@/lib/auth'
import { readPasswordConfig } from '@/lib/data-store'

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
  const persisted = readPasswordConfig()
  const envHash = process.env.ADMIN_PASSWORD_HASH
  const envPlain = process.env.ADMIN_PASSWORD

  let valid = false
  if (persisted.hash) {
    valid = await bcrypt.compare(password, persisted.hash)
  } else if (envHash) {
    valid = await bcrypt.compare(password, envHash)
  } else if (envPlain) {
    valid = password === envPlain
  } else {
    // Dev default — no password configured
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
