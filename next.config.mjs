// Static security headers for the dashboard and every API response.
//
// The Content-Security-Policy is not here: it carries a per-request nonce, so
// src/middleware.ts builds it (src/lib/csp.ts) for every page and API response
// except static assets.
//
// No Strict-Transport-Security here: TLS ends at a reverse proxy the app
// cannot see, and a domain-wide HSTS decision belongs to that proxy.
// X-Frame-Options: DENY backs the CSP's frame-ancestors 'none' for browsers
// that predate CSP level 2.
export function buildSecurityHeaders() {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: custom server (server.ts) handles WebSocket upgrades — no standalone output
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }]
  },
}

export default nextConfig
