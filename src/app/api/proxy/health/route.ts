import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { parseServiceHealthUrls } from '@/lib/service-health'

export const dynamic = 'force-dynamic'

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
  const services = parseServiceHealthUrls(process.env.SERVICE_HEALTH_URLS)

  const results = await Promise.all(
    services.map(async (svc): Promise<ServiceResult> => {
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
