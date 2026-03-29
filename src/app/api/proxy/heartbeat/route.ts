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

  const checkedAt = new Date().toISOString()

  try {
    const start = Date.now()
    const res = await gatewayFetch('/status', { gatewayUrl, token })
    const responseMs = Date.now() - start
    const data = res.ok ? await res.json().catch(() => ({})) : {}
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      responseMs,
      checkedAt,
      data,
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      status: 0,
      responseMs: null,
      checkedAt,
      error: err instanceof Error ? err.message : 'unreachable',
    })
  }
}
