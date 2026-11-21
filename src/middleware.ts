import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, generateNonce } from '@/lib/csp'

// Sets the Content-Security-Policy with a fresh nonce on every page and API
// response. The nonce travels to rendering in the request headers: Next takes
// it from the request's CSP header for its own inline scripts, and the root
// layout reads `x-nonce` for the theme script. The other security headers
// stay static in next.config.mjs. Static assets (/_next/static, /_next/image,
// the favicon) are excluded and carry no CSP: a CSP only governs documents.
export function middleware(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'production')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'],
}
