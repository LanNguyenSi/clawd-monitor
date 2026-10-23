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
 *
 * The request is bounded in time, as the global fetch it replaces was: a
 * connect timeout (including the lookup and the TLS handshake), a timeout for
 * the response headers, and an idle timeout for the body. When one expires the
 * socket is destroyed and the request fails with a PinnedFetchTimeoutError.
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

export interface PinnedFetchTimeouts {
  /** Lookup, TCP connect and TLS handshake together. */
  connectMs: number
  /** From the end of the handshake until the response headers arrive. */
  headersMs: number
  /** Without any byte from the server, while the caller is reading the body. */
  bodyMs: number
}

/**
 * The connect limit is the one undici's global fetch used (10 s); the headers
 * and body limits are its 300 s defaults, so a slow but working gateway behaves
 * as before while a server that never answers no longer holds the request, its
 * socket and the caller indefinitely.
 */
export const DEFAULT_PINNED_TIMEOUTS: PinnedFetchTimeouts = {
  connectMs: 10_000,
  headersMs: 300_000,
  bodyMs: 300_000,
}

/** Replaceable pieces, for tests; production uses the defaults. */
export interface PinnedFetchDeps {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>
  isPublicAddress?: (address: string) => boolean
  timeouts?: Partial<PinnedFetchTimeouts>
}

/** The server did not connect, answer or send data within the allowed time. */
export class PinnedFetchTimeoutError extends Error {
  constructor(phase: 'connect' | 'headers' | 'body', ms: number) {
    super(`Gateway request timed out (${phase}, no progress for ${ms} ms)`)
    this.name = 'PinnedFetchTimeoutError'
  }
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
    if (answers.some((a) => !isPublic(a.address))) {
      throw new GatewayUrlError(NOT_ALLOWED)
    }
    const wanted = Number(options.family) === 4 || Number(options.family) === 6 ? Number(options.family) : 0
    const usable = wanted ? answers.filter((a) => a.family === wanted) : answers
    // Also the case for an empty answer.
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

const NULL_BODY_STATUS = new Set([204, 205, 304])

// A reason phrase the Response constructor accepts: tab, printable ASCII and
// obs-text. The HTTP parser lets other bytes (control characters, DEL) through.
const VALID_STATUS_TEXT = /^[\t\x20-\x7e\x80-\xff]*$/

/**
 * Turn the node response into a fetch Response. Throws a plain Error when the
 * status cannot be represented (fetch only allows 200-599: a 1xx that reaches
 * here, such as 101, or a 6xx-9xx status is a protocol error for a gateway, and
 * the global fetch rejects 1xx too); a reason phrase with illegal bytes is
 * dropped instead, as the global fetch tolerates it.
 */
function toResponse(res: http.IncomingMessage, method: string, guardBody: () => void): Response {
  const status = res.statusCode ?? 0
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error(`Gateway answered with an unsupported HTTP status (${status})`)
  }
  const reason = res.statusMessage ?? ''
  const statusText = VALID_STATUS_TEXT.test(reason) ? reason : ''
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v))
    else if (value !== undefined) headers.set(name, value)
  }
  if (method === 'HEAD' || NULL_BODY_STATUS.has(status)) {
    res.resume()
    return new Response(null, { status, statusText, headers })
  }

  guardBody()
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
    statusText,
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
  const transport = url.protocol === 'https:' ? https : http

  const timeouts = { ...DEFAULT_PINNED_TIMEOUTS, ...deps.timeouts }
  const connectedEvent = url.protocol === 'https:' ? 'secureConnect' : 'connect'

  return new Promise<Response>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const disarm = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
    }
    const arm = (phase: 'connect' | 'headers', ms: number) => {
      disarm()
      timer = setTimeout(() => req.destroy(new PinnedFetchTimeoutError(phase, ms)), ms)
    }
    const fail = (err: Error) => {
      disarm()
      reject(err)
    }

    const req = transport.request(url, {
      method,
      headers,
      signal: init.signal,
      agent: false,
      lookup: createPinnedLookup(deps) as unknown as net.LookupFunction,
    }, (res) => {
      disarm()
      // The caller reads the body when it likes; the socket's idle timer runs
      // only while the stream is flowing, so a slow reader is not a timeout.
      // Only a response with a body is guarded, and by then the body stream
      // listens for the error that destroying the response raises.
      const guardBody = () => {
        const socket = res.socket
        socket.setTimeout(timeouts.bodyMs)
        socket.once('timeout', () => res.destroy(new PinnedFetchTimeoutError('body', timeouts.bodyMs)))
        res.on('pause', () => socket.setTimeout(0))
        res.on('resume', () => socket.setTimeout(timeouts.bodyMs))
      }
      try {
        resolve(toResponse(res, method, guardBody))
      } catch (err) {
        res.destroy()
        reject(err)
      }
    })
    req.on('error', fail)
    req.on('close', disarm)
    req.on('socket', (socket: net.Socket) => {
      socket.once(connectedEvent, () => arm('headers', timeouts.headersMs))
    })
    arm('connect', timeouts.connectMs)
    req.end(init.body)
  })
}
