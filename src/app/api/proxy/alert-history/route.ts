import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const CLAWD_DIR = process.env.CLAWD_DIR ?? '/root/clawd'

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stateFile = join(CLAWD_DIR, 'memory', 'smart-alert-state.json')
    const raw = readFileSync(stateFile, 'utf-8')
    const state = JSON.parse(raw) as {
      lastAlerts?: Record<string, string>
      lastCheck?: string
    }

    const alerts = Object.entries(state.lastAlerts ?? {}).map(([key, ts]) => ({
      key,
      timestamp: ts,
      label: key.replace(/-/g, ' '),
    })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return NextResponse.json({ alerts, lastCheck: state.lastCheck ?? null })
  } catch {
    return NextResponse.json({ alerts: [], lastCheck: null, error: 'No alert history yet' })
  }
}
