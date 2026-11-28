import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { gatewayFetch, GatewayUrlError } from '@/lib/gateway'

interface Props {
  params: Promise<{ path: string[] }>
}

// The catch-all runs on the dashboard origin, so an upstream-chosen content
// type must never reach the response (a served HTML or SVG document would run
// on this origin). JSON answers stay JSON; every other type (or none) becomes
// inert text the browser downloads instead of rendering.
function proxiedHeaders(upstreamType: string | null): Headers {
  const subtype = (upstreamType ?? '').split(';')[0].trim().toLowerCase()
  const isJson = /^application\/(json|[\w.+-]+\+json)$/.test(subtype)
  const headers = new Headers()
  if (isJson) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  } else {
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('Content-Disposition', 'attachment')
  }
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

async function handler(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'X-Content-Type-Options': 'nosniff' } },
    )
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
      urlSource: 'operator',
      token,
      method: req.method,
      body,
    })

    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: proxiedHeaders(res.headers.get('content-type')),
    })
  } catch (err) {
    if (err instanceof GatewayUrlError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400, headers: { 'X-Content-Type-Options': 'nosniff' } },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gateway error' },
      { status: 502, headers: { 'X-Content-Type-Options': 'nosniff' } },
    )
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
