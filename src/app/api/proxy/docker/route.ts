import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'unknown'
  uptime: string
  restarts: number
}

function parseDockerPs(): DockerContainer[] {
  try {
    const out = execSync(
      'docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}\\t{{.RunningFor}}"',
      { encoding: 'utf-8', timeout: 5000 }
    )
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t')
        const statusStr = parts[3] ?? ''
        const restartMatch = statusStr.match(/\((\d+)\)/)
        const restarts = restartMatch ? parseInt(restartMatch[1]) : 0
        const state = (parts[4] ?? 'unknown') as DockerContainer['state']

        return {
          id: (parts[0] ?? '').slice(0, 12),
          name: parts[1] ?? '',
          image: (parts[2] ?? '').split(':')[0] ?? '',
          status: statusStr,
          state: ['running', 'exited', 'paused', 'restarting'].includes(state) ? state : 'unknown',
          uptime: parts[5] ?? '',
          restarts,
        }
      })
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const containers = parseDockerPs()

  if (containers.length === 0) {
    return NextResponse.json({ containers: [], error: 'docker not available or no containers' })
  }

  return NextResponse.json({ containers })
}
