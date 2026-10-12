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
  /** Real restart count from `docker inspect`; omitted when inspect did not return it. */
  restarts?: number
}

/**
 * Reads the real restart count of the given containers with one batched
 * `docker inspect` call. Returns a map from short id to count; a container
 * whose count inspect did not print has no entry.
 */
function collectRestartCounts(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  // Only hex ids reach the shell command.
  const safeIds = ids.filter((id) => /^[0-9a-f]+$/i.test(id))
  if (safeIds.length === 0) return counts
  // docker inspect prints a literal backslash-t for "\\t" in --format (only
  // `docker ps` converts it), so the fields are separated by a plain space.
  const parse = (out: string): void => {
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const [fullId, count] = line.trim().split(/\s+/)
      const n = Number(count)
      if (fullId && count !== undefined && Number.isInteger(n) && n >= 0) {
        counts.set(fullId.slice(0, 12), n)
      }
    }
  }
  try {
    parse(execSync(
      `docker inspect --format "{{.Id}} {{.RestartCount}}" ${safeIds.join(' ')}`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
    ))
  } catch (err) {
    // inspect exits non-zero when one id vanished but still prints the others
    const partial = (err as { stdout?: unknown }).stdout
    if (typeof partial === 'string') parse(partial)
    // otherwise report no restart count rather than a made-up one
  }
  return counts
}

function parseDockerPs(): DockerContainer[] {
  try {
    const out = execSync(
      'docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}\\t{{.RunningFor}}"',
      { encoding: 'utf-8', timeout: 5000 }
    )
    const containers: DockerContainer[] = out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t')
        const statusStr = parts[3] ?? ''
        const state = (parts[4] ?? 'unknown') as DockerContainer['state']

        return {
          id: (parts[0] ?? '').slice(0, 12),
          name: parts[1] ?? '',
          image: (parts[2] ?? '').split(':')[0] ?? '',
          status: statusStr,
          state: ['running', 'exited', 'paused', 'restarting'].includes(state) ? state : 'unknown',
          uptime: parts[5] ?? '',
        }
      })
    const counts = collectRestartCounts(containers.map((c) => c.id))
    for (const c of containers) {
      const n = counts.get(c.id)
      if (n !== undefined) c.restarts = n
    }
    return containers
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
