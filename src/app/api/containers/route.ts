import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const out = execSync(
      'docker ps --format "{{.Names}}"',
      { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const containers = out.trim().split('\n').filter(Boolean).sort()
    return NextResponse.json({ containers })
  } catch {
    return NextResponse.json({ containers: [], error: 'docker not available' })
  }
}
