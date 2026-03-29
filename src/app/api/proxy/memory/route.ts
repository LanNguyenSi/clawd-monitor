import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const CLAWD_DIR = process.env.CLAWD_DIR ?? '/root/clawd'

const FILES: Record<string, string> = {
  memory: join(CLAWD_DIR, 'MEMORY.md'),
  current: join(CLAWD_DIR, 'CURRENT.md'),
}

function todayFile(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return join(CLAWD_DIR, 'memory', `${y}-${m}-${day}.md`)
}

function yesterdayFile(): string {
  const d = new Date(Date.now() - 86400000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return join(CLAWD_DIR, 'memory', `${y}-${m}-${day}.md`)
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const file = searchParams.get('file') ?? 'memory'

  let filePath: string
  if (file === 'today') filePath = todayFile()
  else if (file === 'yesterday') filePath = yesterdayFile()
  else filePath = FILES[file] ?? FILES.memory

  try {
    const content = readFileSync(filePath, 'utf-8')
    const stat = statSync(filePath)
    return NextResponse.json({
      file,
      path: filePath,
      content,
      updatedAt: stat.mtime.toISOString(),
    })
  } catch {
    return NextResponse.json({ error: `File not found: ${filePath}` }, { status: 404 })
  }
}
