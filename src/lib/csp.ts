// Per-request Content-Security-Policy for pages and API responses.
//
// script-src carries a fresh nonce instead of 'unsafe-inline': Next reads the
// nonce from the request's CSP header and stamps it on its own inline
// hydration scripts, and the root layout stamps it on the theme script. A
// nonce source makes browsers ignore 'unsafe-inline', so none is listed.
// 'strict-dynamic' is not needed: every script is either same-origin
// ('self') or an inline script that carries the nonce.
// 'unsafe-eval' is added only outside production (React dev tooling).
// style-src keeps 'unsafe-inline' for style attributes (react-grid-layout
// positions widgets with inline transforms) and Next's inline style tags.
//
// What the browser really loads (all same-origin): the app's own scripts and
// CSS, next/font/local fonts, the favicon, fetch/SWR calls and EventSource
// streams to /api/*. Gateway, GitHub and Docker calls are made by the server
// (the /api/proxy routes), never by the browser, so connect-src needs no
// remote origin; the agent WebSocket is opened by agents, not by the page.
// img-src 'self' data: blocks remote images on purpose, including ones in
// agent memory Markdown (MemoryWidget, react-markdown): they would leak the
// viewer's address to a third party, so such images do not render.

/** 128 random bits, base64 (CSP nonce-source grammar). Edge-runtime safe. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function buildCsp(nonce: string, production: boolean): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`]
  if (!production) scriptSrc.push("'unsafe-eval'")
  return [
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
}
