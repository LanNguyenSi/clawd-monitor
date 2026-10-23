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
    const res = await gatewayFetch('/sessions', { gatewayUrl, urlSource: 'operator', token })
    if (!res.ok) {
      // An unread body keeps its connection open until it is collected.
      await res.body?.cancel()
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
