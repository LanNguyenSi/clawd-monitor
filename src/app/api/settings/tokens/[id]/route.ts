import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { readTokens, writeTokens } from '@/lib/data-store'

interface Props { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  let body: { name?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tokens = readTokens()
  const idx = tokens.findIndex((t) => t.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  if (body.name) tokens[idx].name = body.name.trim()
  writeTokens(tokens)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const tokens = readTokens()
  const filtered = tokens.filter((t) => t.id !== id)
  if (filtered.length === tokens.length) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }
  writeTokens(filtered)
  return NextResponse.json({ ok: true })
}
