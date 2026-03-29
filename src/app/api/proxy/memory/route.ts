import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { gatewayFetch } from '@/lib/gateway'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

/**
 * Memory file proxy.
 *
 * Strategy (in order):
 * 1. Try OpenClaw Gateway /workspace/memory?file=<name> (works for remote instances)
 * 2. Fall back to direct filesystem read (works when clawd-monitor runs on the same VPS as OpenClaw)
 */

const CLAWD_DIR = process.env.CLAWD_DIR ?? '/root/clawd'

const FILE_PATHS: Record<string, string> = {
  memory:    join(CLAWD_DIR, 'MEMORY.md'),
  current:   join(CLAWD_DIR, 'CURRENT.md'),
}

function dailyPath(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86400000)
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
  const gatewayUrl = req.headers.get('x-gateway-url') ?? undefined
  const token = req.headers.get('x-gateway-token') ?? undefined

  // 1. Try Gateway /workspace/memory endpoint (remote-friendly)
  try {
    const res = await gatewayFetch(`/workspace/memory?file=${encodeURIComponent(file)}`, {
      gatewayUrl,
      token,
    })
    if (res.ok) {
      const data = await res.json()
      return NextResponse.json(data)
    }
  } catch {
    // Gateway doesn't support this endpoint — fall through to filesystem
  }

  // 2. Filesystem fallback (same-VPS mode)
  let filePath: string
  if (file === 'today')     filePath = dailyPath(0)
  else if (file === 'yesterday') filePath = dailyPath(1)
  else filePath = FILE_PATHS[file] ?? FILE_PATHS.memory

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
      error: `Memory files not accessible. Configure CLAWD_DIR or connect via OpenClaw Gateway.`,
      hint: 'Add this instance via the Instance Switcher with your OpenClaw Gateway URL + token.',
    }, { status: 404 })
  }
}
