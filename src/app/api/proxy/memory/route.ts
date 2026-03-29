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

  // If CLAWD_DIR doesn't exist on this host, return graceful empty response
  try {
    statSync(CLAWD_DIR)
  } catch {
    return NextResponse.json({
      file,
      path: filePath,
      content: `> Memory not available — clawd-monitor is running on a different host than the OpenClaw workspace.\n>\n> Set \`CLAWD_DIR\` to the correct path, or use the Gateway API integration (coming soon).`,
      updatedAt: new Date().toISOString(),
      unavailable: true,
    })
  }

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
    return NextResponse.json({
      file,
      path: filePath,
      content: `> File not found: \`${filePath}\``,
      updatedAt: new Date().toISOString(),
    })
  }
}
