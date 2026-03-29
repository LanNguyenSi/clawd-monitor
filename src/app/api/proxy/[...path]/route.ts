import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { gatewayFetch } from '@/lib/gateway'

interface Props {
  params: Promise<{ path: string[] }>
}

async function handler(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { path } = await params
  const gatewayPath = '/' + path.join('/')

  // Forward query params
  const url = new URL(req.url)
  const fullPath = url.search ? `${gatewayPath}${url.search}` : gatewayPath

  // Get instance config from request header (set by client)
  const gatewayUrl = req.headers.get('x-gateway-url') ?? undefined
  const token = req.headers.get('x-gateway-token') ?? undefined

  let body: unknown = undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await req.json() } catch { /* no body */ }
  }

  try {
    const res = await gatewayFetch(fullPath, {
      gatewayUrl,
      token,
      method: req.method,
      body,
    })

    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gateway error' },
      { status: 502 }
    )
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
