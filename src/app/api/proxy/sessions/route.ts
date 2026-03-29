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
    const res = await gatewayFetch('/sessions', { gatewayUrl, token })
    if (!res.ok) {
      return NextResponse.json({ sessions: [], error: `Gateway returned ${res.status}` })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({
      sessions: [],
      error: err instanceof Error ? err.message : 'Gateway unavailable',
    })
  }
}
