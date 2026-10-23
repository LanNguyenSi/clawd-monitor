/**
 * Outbound request with a pinned address.
 *
 * undici's fetch over an undici Agent whose connector uses createPinnedLookup:
 * a host name is resolved once, inside the `lookup` the socket itself uses to
 * connect. Every address it returns must be public (one non-public answer
 * rejects the whole request), and the socket connects only to the checked
 * addresses. There is no second resolution between the check and the connect,
 * so a DNS answer that changes in between (rebinding) cannot redirect the
 * request. The Agent pools connections per origin; a pooled connection was
 * checked when it was made, and every new connection runs the check again.
 *
 * The request lifecycle (status line, informational and upgrade answers, body
 * streaming and decoding, releasing the socket) is fetch's own. TLS uses the
 * host name for SNI and certificate verification, and a redirect answer is
 * returned as it is, never followed. The time limits are the Agent's: one for
 * connecting (lookup, TCP and TLS), one for the response headers, and one for a
 * body that sends nothing while it is being read.
 */
import dns from 'node:dns'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
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
  /** From sending the request until the response headers arrive. */
  headersMs: number
  /** Without any byte from the server, while the body is being read. */
  bodyMs: number
}

/**
 * The limits of the global fetch: undici's 10 s connect timeout and its 300 s
 * headers and body defaults, so a slow but working gateway behaves as with the
 * global fetch.
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
  /** CA certificates (PEM) that replace the default trust store, for a local TLS server. */
  ca?: string[]
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

/** An Agent that connects only through the pinned lookup, with the time limits. */
export function createPinnedAgent(deps: PinnedFetchDeps = {}): Agent {
  const timeouts = { ...DEFAULT_PINNED_TIMEOUTS, ...deps.timeouts }
  return new Agent({
    connectTimeout: timeouts.connectMs,
    headersTimeout: timeouts.headersMs,
    bodyTimeout: timeouts.bodyMs,
    connect: {
      lookup: createPinnedLookup(deps) as unknown as net.LookupFunction,
      ...(deps.ca ? { ca: deps.ca } : {}),
    },
  })
}

// One Agent (one connection pool) per set of dependencies. Production passes
// none and so shares a single Agent.
const PRODUCTION_DEPS: PinnedFetchDeps = {}
const agents = new WeakMap<PinnedFetchDeps, Agent>()

function agentFor(deps: PinnedFetchDeps): Agent {
  let agent = agents.get(deps)
  if (!agent) {
    agent = createPinnedAgent(deps)
    agents.set(deps, agent)
  }
  return agent
}

/**
 * Fetch `rawUrl` with the address pinned as described above. Rejects with a
 * GatewayUrlError when the host, or any address it resolves to, is not public.
 * The caller has already applied the URL rules (scheme, allowlist, port).
 */
export async function pinnedFetch(
  rawUrl: string,
  init: PinnedFetchInit = {},
  deps: PinnedFetchDeps = PRODUCTION_DEPS,
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

  try {
    const res = await undiciFetch(url, { ...init, redirect: 'manual', dispatcher: agentFor(deps) })
    // undici's Response class, with the same interface as the global one.
    return res as unknown as Response
  } catch (err) {
    // fetch reports a failed connection as TypeError('fetch failed') with the
    // reason as its cause. A rejection by the lookup is passed on as itself, so
    // a caller can tell a refused address from an unreachable gateway.
    if (err instanceof TypeError && err.cause instanceof GatewayUrlError) throw err.cause
    throw err
  }
}
