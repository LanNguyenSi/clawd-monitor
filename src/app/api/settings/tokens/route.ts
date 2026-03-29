import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { isAuthenticated } from '@/lib/auth'
import { readTokens, writeTokens } from '@/lib/data-store'

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokens = readTokens().map(({ id, name, createdAt, lastUsedAt }) => ({
    id, name, createdAt, lastUsedAt
  }))

  return NextResponse.json({ tokens })
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { name?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = await bcrypt.hash(rawToken, 10)
  const id = randomUUID()

  const tokens = readTokens()
  tokens.push({ id, name: body.name.trim(), tokenHash, createdAt: new Date().toISOString() })
  writeTokens(tokens)

  return NextResponse.json({ token: rawToken, id, name: body.name.trim() }, { status: 201 })
}
