import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const DEFAULT_SERVICES = [
  { name: 'depsight',      url: 'https://depsight.opentriologue.ai' },
  { name: 'ci-insights',   url: 'https://ci-insights.opentriologue.ai' },
  { name: 'project-forge', url: 'https://project-forge.opentriologue.ai' },
]

interface ServiceResult {
  name: string
  url: string
  ok: boolean
  status: number
  responseMs: number
  checkedAt: string
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checkedAt = new Date().toISOString()

  const results = await Promise.all(
    DEFAULT_SERVICES.map(async (svc): Promise<ServiceResult> => {
      const start = Date.now()
      try {
        const res = await fetch(svc.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        })
        return {
          name: svc.name,
          url: svc.url,
          ok: res.ok || res.status < 500,
          status: res.status,
          responseMs: Date.now() - start,
          checkedAt,
        }
      } catch {
        return {
          name: svc.name,
          url: svc.url,
          ok: false,
          status: 0,
          responseMs: Date.now() - start,
          checkedAt,
        }
      }
    })
  )

  return NextResponse.json({ services: results })
}
