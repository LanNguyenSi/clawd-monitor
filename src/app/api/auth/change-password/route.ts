import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isAuthenticated } from '@/lib/auth'
import { readPasswordConfig, writePasswordConfig } from '@/lib/data-store'

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
  const config = readPasswordConfig()
  const envHash = process.env.ADMIN_PASSWORD_HASH
  const envPlain = process.env.ADMIN_PASSWORD

  let currentValid = false
  if (config.hash) {
    currentValid = await bcrypt.compare(currentPassword, config.hash)
  } else if (envHash) {
    currentValid = await bcrypt.compare(currentPassword, envHash)
  } else if (envPlain) {
    currentValid = currentPassword === envPlain
  } else {
    // Dev default
    currentValid = currentPassword === 'admin'
  }

  if (!currentValid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  // Hash and save new password
  const newHash = await bcrypt.hash(newPassword, 12)
  writePasswordConfig({ hash: newHash })

  return NextResponse.json({ ok: true })
}
