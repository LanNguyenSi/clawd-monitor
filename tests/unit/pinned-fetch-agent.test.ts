/**
 * How pinnedFetch (src/lib/pinned-fetch.ts) wires undici: which Agent it builds,
 * with which limits and lookup, and what it hands to undici's fetch. undici's
 * fetch is replaced by a recorder here, so nothing is connected; the transport
 * itself runs against local servers in pinned-fetch.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  agents: [] as Array<{ agent: unknown; options: Record<string, unknown> }>,
  fetchCalls: [] as Array<[URL, Record<string, unknown>]>,
  fetchImpl: undefined as undefined | (() => Promise<Response>),
}))

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  class RecordingAgent extends actual.Agent {
    constructor(options: ConstructorParameters<typeof actual.Agent>[0]) {
      super(options)
      h.agents.push({ agent: this, options: options as Record<string, unknown> })
    }
  }
  return {
    ...actual,
    Agent: RecordingAgent,
    fetch: vi.fn(async (url: URL, init: Record<string, unknown>) => {
      h.fetchCalls.push([url, init])
      return h.fetchImpl ? h.fetchImpl() : new Response('ok')
    }),
  }
})

import { pinnedFetch, type PinnedFetchDeps } from '@/lib/pinned-fetch'
import { GatewayUrlError } from '@/lib/gateway-policy'

type Lookup = (host: string, options: { all?: boolean }, cb: (err: Error | null) => void) => void

/** The options of the agent the latest fetch call was dispatched to. */
function lastAgentOptions(): Record<string, unknown> {
  const dispatcher = h.fetchCalls[h.fetchCalls.length - 1][1].dispatcher
  const entry = h.agents.find((a) => a.agent === dispatcher)
  expect(entry).toBeDefined()
  return entry!.options
}

beforeEach(() => {
  h.fetchCalls.length = 0
  h.fetchImpl = undefined
})

describe('pinnedFetch, production agent', () => {
  it('builds one agent for all production requests, with the default limits and the pinned lookup', async () => {
    await pinnedFetch('https://gw.example.com/a', { method: 'GET', headers: { Authorization: 'Bearer t' } })
    const created = h.agents.length
    await pinnedFetch('https://other.example.com/b')
    expect(h.agents.length).toBe(created)
    const options = lastAgentOptions()
    expect(options).toMatchObject({ connectTimeout: 10_000, headersTimeout: 300_000, bodyTimeout: 300_000 })
    const connect = options.connect as { lookup: unknown; ca?: unknown }
    expect(typeof connect.lookup).toBe('function')
    expect(connect).not.toHaveProperty('ca')

    expect(h.fetchCalls).toHaveLength(2)
    const [[url, init], [, second]] = h.fetchCalls
    expect(url.href).toBe('https://gw.example.com/a')
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer t' }, redirect: 'manual' })
    expect(init.dispatcher).toBeDefined()
    expect(second.dispatcher).toBe(init.dispatcher)
  })

  it('gives the production agent a lookup that applies the address policy', async () => {
    await pinnedFetch('https://gw.example.com/')
    const lookup = (lastAgentOptions().connect as { lookup: Lookup }).lookup
    // An IP literal resolves to itself without any network.
    const err = await new Promise<Error | null>((resolve) => lookup('127.0.0.1', { all: true }, resolve))
    expect(err).toBeInstanceOf(GatewayUrlError)
  })

  it('sends redirect manual whatever the caller passes', async () => {
    await pinnedFetch('https://gw.example.com/', { redirect: 'follow' } as never)
    expect(h.fetchCalls[0][1].redirect).toBe('manual')
  })
})

describe('pinnedFetch, test dependencies', () => {
  it('builds an agent of its own with the given limits and trusted certificates', async () => {
    const deps: PinnedFetchDeps = { timeouts: { connectMs: 1, headersMs: 2, bodyMs: 3 }, ca: ['PEM'] }
    const before = h.agents.length
    await pinnedFetch('https://gw.example.com/', {}, deps)
    await pinnedFetch('https://gw.example.com/', {}, deps)
    expect(h.agents.length - before).toBe(1)
    const options = lastAgentOptions()
    expect(options).toMatchObject({ connectTimeout: 1, headersTimeout: 2, bodyTimeout: 3 })
    expect((options.connect as { ca?: unknown }).ca).toEqual(['PEM'])
  })

  it('keeps the default for a limit the dependencies leave out', async () => {
    await pinnedFetch('https://gw.example.com/', {}, { timeouts: { headersMs: 2 } })
    const options = lastAgentOptions()
    expect(options).toMatchObject({ connectTimeout: 10_000, headersTimeout: 2, bodyTimeout: 300_000 })
  })
})

describe('pinnedFetch, failures', () => {
  it('passes a lookup rejection on as the GatewayUrlError itself', async () => {
    const refused = new GatewayUrlError('Gateway host not allowed')
    h.fetchImpl = async () => { throw new TypeError('fetch failed', { cause: refused }) }
    await expect(pinnedFetch('https://gw.example.com/')).rejects.toBe(refused)
  })

  it('leaves any other fetch failure as it is', async () => {
    const failed = new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    h.fetchImpl = async () => { throw failed }
    await expect(pinnedFetch('https://gw.example.com/')).rejects.toBe(failed)
    const plain = new RangeError('boom')
    h.fetchImpl = async () => { throw plain }
    await expect(pinnedFetch('https://gw.example.com/')).rejects.toBe(plain)
  })

  it('does not unwrap a GatewayUrlError cause of an error that is not fetch failing', async () => {
    const odd = new RangeError('boom', { cause: new GatewayUrlError('x') })
    h.fetchImpl = async () => { throw odd }
    await expect(pinnedFetch('https://gw.example.com/')).rejects.toBe(odd)
  })
})
