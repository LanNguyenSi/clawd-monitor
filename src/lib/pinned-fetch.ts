/**
 * Outbound request with a pinned address.
 *
 * A host name is resolved once, inside the `lookup` the socket itself uses to
 * connect. Every address it returns must be public (one private answer rejects
 * the whole set), and the socket connects to exactly those checked addresses.
 * There is no second resolution between the check and the connect, so a DNS
 * answer that changes in between (rebinding) cannot redirect the request.
 *
 * Built on node:http and node:https because the global fetch cannot be given a
 * connect-time lookup without a separate undici dependency. TLS still uses the
 * host name for SNI and certificate verification, and a redirect answer is
 * returned as it is, never followed. Each request uses a fresh agent, so no
 * pooled socket that was connected earlier is reused.
 */
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable, pipeline } from 'node:stream'
import zlib from 'node:zlib'
import { GatewayUrlError, isPrivateHost } from './gateway-policy'

export interface ResolvedAddress {
  address: string
  family: number
}

export interface PinnedFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/** Replaceable pieces, for tests; production uses the defaults. */
export interface PinnedFetchDeps {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>
  isPublicAddress?: (address: string) => boolean
}

const defaultResolve = (hostname: string): Promise<ResolvedAddress[]> =>
  dns.promises.lookup(hostname, { all: true, verbatim: true })

const defaultIsPublic = (address: string): boolean => !isPrivateHost(address)

const NOT_ALLOWED = 'Gateway host not allowed'

type LookupOptions = { all?: boolean; family?: number | string }
type LookupCallback = (
  err: Error | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void

/**
 * A `lookup` for net.connect that resolves the host, rejects the request when
 * any answer is not public, and hands the connection only the checked
 * addresses.
 */
export function createPinnedLookup(deps: PinnedFetchDeps = {}) {
  const resolve = deps.resolve ?? defaultResolve
  const isPublic = deps.isPublicAddress ?? defaultIsPublic
  // Resolves, judges the whole answer, and returns the addresses the
  // connection may use. Throws when the answer is empty, any address is not
  // public, or none has the requested family.
  const checked = async (hostname: string, options: LookupOptions): Promise<ResolvedAddress[]> => {
    const answers = await resolve(hostname)
    if (answers.length === 0 || answers.some((a) => !isPublic(a.address))) {
      throw new GatewayUrlError(NOT_ALLOWED)
    }
    const wanted = Number(options.family) === 4 || Number(options.family) === 6 ? Number(options.family) : 0
    const usable = wanted ? answers.filter((a) => a.family === wanted) : answers
    if (usable.length === 0) throw new GatewayUrlError(NOT_ALLOWED)
    return usable
  }
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    checked(hostname, options).then(
      (usable) => {
        if (options.all) callback(null, usable)
        else callback(null, usable[0].address, usable[0].family)
      },
      (err: Error) => callback(err),
    )
  }
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

function toResponse(res: http.IncomingMessage, method: string): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v))
    else if (value !== undefined) headers.set(name, value)
  }
  const status = res.statusCode ?? 502
  if (method === 'HEAD' || NULL_BODY_STATUS.has(status)) {
    res.resume()
    return new Response(null, { status, statusText: res.statusMessage, headers })
  }

  let source: Readable = res
  const encoding = (res.headers['content-encoding'] ?? '').toLowerCase()
  const decoder =
    encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
    : encoding === 'deflate' ? zlib.createInflate()
    : encoding === 'br' ? zlib.createBrotliDecompress()
    : null
  if (decoder) {
    source = pipeline(res, decoder, () => { /* an error destroys the decoded stream */ })
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  return new Response(Readable.toWeb(source) as unknown as ReadableStream, {
    status,
    statusText: res.statusMessage,
    headers,
  })
}

/**
 * Fetch `rawUrl` with the address pinned as described above. Rejects with a
 * GatewayUrlError when the host, or any address it resolves to, is not public.
 * The caller has already applied the URL rules (scheme, allowlist, port).
 */
export async function pinnedFetch(
  rawUrl: string,
  init: PinnedFetchInit = {},
  deps: PinnedFetchDeps = {},
): Promise<Response> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GatewayUrlError('Invalid gateway URL')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // A literal IP is connected to without a lookup, so it is checked here.
  if (net.isIP(host) !== 0 && !(deps.isPublicAddress ?? defaultIsPublic)(host)) {
    throw new GatewayUrlError(NOT_ALLOWED)
  }

  const method = init.method ?? 'GET'
  const headers: Record<string, string> = { 'accept-encoding': 'identity', ...init.headers }
  if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body))
  const transport = url.protocol === 'https:' ? https : http

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers,
      signal: init.signal,
      agent: false,
      lookup: createPinnedLookup(deps) as unknown as net.LookupFunction,
    }, (res) => resolve(toResponse(res, method)))
    req.on('error', reject)
    req.end(init.body)
  })
}
