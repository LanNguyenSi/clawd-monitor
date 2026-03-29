import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { gatewayFetch } from '@/lib/gateway'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gatewayUrl = req.headers.get('x-gateway-url') ?? undefined
  const token = req.headers.get('x-gateway-token') ?? undefined
  try {
    const res = await gatewayFetch('/cron/jobs', { gatewayUrl, token })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ jobs: [], error: err instanceof Error ? err.message : 'Gateway unavailable' })
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gatewayUrl = req.headers.get('x-gateway-url') ?? undefined
  const token = req.headers.get('x-gateway-token') ?? undefined
  const { jobId } = await req.json() as { jobId: string }
  try {
    const res = await gatewayFetch(`/cron/jobs/${jobId}/run`, { gatewayUrl, token, method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Trigger failed' }, { status: 502 })
  }
}
