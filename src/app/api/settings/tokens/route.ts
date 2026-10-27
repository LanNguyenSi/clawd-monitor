import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { isAuthenticated } from '@/lib/auth'
import { readTokens, writeTokens, type TokenEntry } from '@/lib/data-store'

function tokenStoreUnavailable(err: unknown) {
  console.error(`[tokens] Could not read the token store: ${err instanceof Error ? err.message : 'unknown error'}`)
  return NextResponse.json({ error: 'Token store unavailable' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let stored: TokenEntry[]
  try {
    stored = readTokens()
  } catch (err) {
    return tokenStoreUnavailable(err)
  }
  const tokens = stored.map(({ id, name, createdAt, lastUsedAt }) => ({
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

  // A store that cannot be read is not an empty one: writing a new list over
  // it would destroy the tokens a repaired file still holds.
  let tokens: TokenEntry[]
  try {
    tokens = readTokens()
  } catch (err) {
    return tokenStoreUnavailable(err)
  }
  tokens.push({ id, name: body.name.trim(), tokenHash, createdAt: new Date().toISOString() })
  writeTokens(tokens)

  return NextResponse.json({ token: rawToken, id, name: body.name.trim() }, { status: 201 })
}
