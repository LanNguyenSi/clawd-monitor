// Content-Security-Policy for the dashboard and every API response.
//
// What the browser really loads (all same-origin): the app's own scripts and
// CSS, next/font/local fonts, the favicon, fetch/SWR calls and EventSource
// streams to /api/*. Gateway, GitHub and Docker calls are made by the server
// (the /api/proxy routes), never by the browser, so connect-src needs no
// remote origin; the agent WebSocket is opened by agents, not by the page.
//
// script-src keeps 'unsafe-inline': Next's App Router writes its hydration
// payload as inline scripts without a nonce, and a hash or nonce source would
// make browsers ignore 'unsafe-inline', blocking those scripts. A nonce needs
// middleware and per-request rendering, which this app does not use.
// 'unsafe-eval' is added only outside production (React dev tooling).
// style-src keeps 'unsafe-inline' for style attributes (react-grid-layout
// positions widgets with inline transforms) and Next's inline style tags.
//
// No Strict-Transport-Security here: TLS ends at a reverse proxy the app
// cannot see, and a domain-wide HSTS decision belongs to that proxy.
// img-src 'self' data: blocks remote images on purpose, including ones in
// agent memory Markdown (MemoryWidget, react-markdown): they would leak the
// viewer's address to a third party, so such images do not render.
// X-Frame-Options: DENY backs frame-ancestors 'none' for browsers that
// predate CSP level 2.
export function buildSecurityHeaders(production) {
  const scriptSrc = ["'self'", "'unsafe-inline'"]
  if (!production) scriptSrc.push("'unsafe-eval'")
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: custom server (server.ts) handles WebSocket upgrades — no standalone output
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders(process.env.NODE_ENV === 'production') }]
  },
}

export default nextConfig
