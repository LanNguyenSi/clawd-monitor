/**
 * Pinned-address fetch (src/lib/pinned-fetch.ts).
 *
 * No outside network: the resolver is a stub and the only connections are to
 * servers on 127.0.0.1 started by the test. One test runs the production agent
 * on the name `localhost`, which the system resolver answers locally. The
 * address policy is replaced by "everything is public" only where a test has to
 * reach a local server; the policy tests use the real one.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import v8 from 'node:v8'
import vm from 'node:vm'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import {
  createPinnedLookup,
  pinnedFetch,
  DEFAULT_PINNED_TIMEOUTS,
  type PinnedFetchDeps,
  type ResolvedAddress,
} from '@/lib/pinned-fetch'
import { GatewayUrlError } from '@/lib/gateway-policy'

const v4 = (address: string): ResolvedAddress => ({ address, family: 4 })
const v6 = (address: string): ResolvedAddress => ({ address, family: 6 })

type LookupResult = { err: Error | null; address?: string | ResolvedAddress[]; family?: number }

function runLookup(
  answers: ResolvedAddress[] | Error,
  options: { all?: boolean; family?: number | string } = {},
): Promise<LookupResult> {
  const lookup = createPinnedLookup({
    resolve: async () => {
      if (answers instanceof Error) throw answers
      return answers
    },
  })
  return new Promise((resolve) => {
    lookup('gw.example.com', options, (err, address, family) => resolve({ err, address, family }))
  })
}

describe('createPinnedLookup, address policy', () => {
  it.each([
    ['loopback', [v4('127.0.0.1')]],
    ['private 10/8', [v4('10.1.2.3')]],
    ['private 172.16/12', [v4('172.16.5.5')]],
    ['private 192.168/16', [v4('192.168.1.10')]],
    ['link-local metadata address', [v4('169.254.169.254')]],
    ['carrier-grade NAT', [v4('100.64.1.1')]],
    ['unspecified', [v4('0.0.0.0')]],
    ['IPv6 loopback', [v6('::1')]],
    ['IPv6 unspecified', [v6('::')]],
    ['IPv6 unique-local', [v6('fd12:3456::1')]],
    ['IPv6 link-local', [v6('fe80::1')]],
    ['IPv4-mapped loopback, dotted', [v6('::ffff:127.0.0.1')]],
    ['IPv4-mapped loopback, hex', [v6('::ffff:7f00:1')]],
    ['documentation range 203.0.113.0/24', [v4('203.0.113.9')]],
    ['documentation range 192.0.2.0/24', [v4('192.0.2.1')]],
    ['documentation range 198.51.100.0/24', [v4('198.51.100.1')]],
    ['IPv6 documentation range', [v6('2001:db8::1')]],
    ['Teredo', [v6('2001:0:4136:e378:8000:63bf:3fff:fdd2')]],
    ['IPv4-translated', [v6('::ffff:0:808:808')]],
    ['local-use NAT64', [v6('64:ff9b:1::1')]],
    ['discard-only prefix', [v6('100::1')]],
  ])('rejects a name that resolves to %s', async (_label, answers) => {
    const { err, address } = await runLookup(answers)
    expect(err).toBeInstanceOf(GatewayUrlError)
    expect(err?.message).toBe('Gateway host not allowed')
    expect(address).toBeUndefined()
  })

  it.each([
    ['public first, private second', [v4('93.184.216.34'), v4('10.0.0.5')]],
    ['private first, public second', [v4('10.0.0.5'), v4('93.184.216.34')]],
    ['public IPv4 with a loopback IPv6', [v4('93.184.216.34'), v6('::1')]],
    ['public IPv6 with a mapped loopback', [v6('2606:4700::1111'), v6('::ffff:127.0.0.1')]],
  ])('rejects a mixed answer (%s) as a whole', async (_label, answers) => {
    const { err } = await runLookup(answers, { all: true })
    expect(err).toBeInstanceOf(GatewayUrlError)
  })

  it('rejects an empty answer', async () => {
    const { err } = await runLookup([])
    expect(err).toBeInstanceOf(GatewayUrlError)
  })

  it('hands back the checked address and family for a public answer', async () => {
    const { err, address, family } = await runLookup([v4('93.184.216.34'), v6('2606:4700::1111')])
    expect(err).toBeNull()
    expect(address).toBe('93.184.216.34')
    expect(family).toBe(4)
  })

  it('hands back every checked address when the socket asks for all of them', async () => {
    const answers = [v4('93.184.216.34'), v6('2606:4700::1111')]
    const { err, address } = await runLookup(answers, { all: true })
    expect(err).toBeNull()
    expect(address).toEqual(answers)
  })

  it('honours a requested family but still judged the whole answer first', async () => {
    const answers = [v4('93.184.216.34'), v6('2606:4700::1111')]
    expect((await runLookup(answers, { family: 6 })).address).toBe('2606:4700::1111')
    expect((await runLookup(answers, { family: '4', all: true })).address).toEqual([answers[0]])
    // The private IPv6 answer is not what was asked for, yet it still rejects.
    expect((await runLookup([v4('93.184.216.34'), v6('::1')], { family: 4 })).err).toBeInstanceOf(GatewayUrlError)
  })

  it('rejects when no checked address has the requested family', async () => {
    const { err } = await runLookup([v4('93.184.216.34')], { family: 6 })
    expect(err).toBeInstanceOf(GatewayUrlError)
  })

  it('answers the connection with an error, not silence, when the policy itself throws', async () => {
    const boom = new Error('policy bug')
    const lookup = createPinnedLookup({
      resolve: async () => [v4('93.184.216.34')],
      isPublicAddress: () => { throw boom },
    })
    const err = await new Promise<Error | null>((resolve) => {
      lookup('gw.example.com', {}, (e) => resolve(e))
    })
    expect(err).toBe(boom)
  })

  it('passes a resolver failure through unchanged', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    const { err } = await runLookup(failure)
    expect(err).toBe(failure)
  })
})


const allowAll = () => true

/** The code of the reason fetch attached to a failure (undici reports it as the cause). */
function causeCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code
}

/** `promise`, or 'HUNG' when it has not settled after `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'HUNG'> {
  let timer: NodeJS.Timeout | undefined
  const hung = new Promise<'HUNG'>((resolve) => { timer = setTimeout(() => resolve('HUNG'), ms) })
  try {
    return await Promise.race([promise, hung])
  } finally {
    clearTimeout(timer)
  }
}

const until = async (predicate: () => boolean, ms = 3000) => {
  const started = Date.now()
  while (!predicate() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 20))
}

describe('pinnedFetch, local server', () => {
  let server: http.Server
  let port: number
  let connections = 0
  const hits: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: string }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        hits.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/internal-target' })
          res.end()
        } else if (req.url === '/empty') {
          res.writeHead(204)
          res.end()
        } else if (req.url === '/gzip') {
          res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/plain' })
          res.end(zlib.gzipSync('zipped line\n'))
        } else if (req.url === '/cookies') {
          res.writeHead(200, { 'Set-Cookie': ['a=1', 'b=2'] })
          res.end('ok')
        } else if (req.url === '/close') {
          res.writeHead(200, { Connection: 'close' })
          res.end('closed')
        } else if (req.url === '/slow') {
          res.writeHead(200)
          res.write('first\n')
          // never ends: the caller aborts
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: req.url }))
        }
      })
    })
    server.on('connection', () => { connections += 1 })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => {
    hits.length = 0
    connections = 0
  })

  it('connects to the address it checked and never resolves the name a second time (rebinding)', async () => {
    let calls = 0
    const resolve = vi.fn(async () => {
      calls += 1
      // First answer: the address the check saw. Any later answer: where a
      // rebinding DNS server would point the second lookup.
      return calls === 1 ? [v4('127.0.0.1')] : [v4('93.184.216.34')]
    })
    const res = await pinnedFetch(`http://gw.test:${port}/status?x=1`, {}, { resolve, isPublicAddress: allowAll })
    expect(await res.json()).toEqual({ ok: true, path: '/status?x=1' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('gw.test')
    expect(hits).toHaveLength(1)
    // The request still names the host, not the pinned address.
    expect(hits[0].headers.host).toBe(`gw.test:${port}`)
  })

  it('reuses a pooled connection to the same origin, which was checked when it was made', async () => {
    const shared: PinnedFetchDeps = { resolve: vi.fn(async () => [v4('127.0.0.1')]), isPublicAddress: allowAll }
    await (await pinnedFetch(`http://gw.test:${port}/a`, {}, shared)).text()
    // Give the pool a moment to take the finished connection back.
    await new Promise((r) => setTimeout(r, 50))
    await (await pinnedFetch(`http://gw.test:${port}/b`, {}, shared)).text()
    expect(shared.resolve).toHaveBeenCalledTimes(1)
    expect(connections).toBe(1)
    expect(hits.map((h) => h.url)).toEqual(['/a', '/b'])
  })

  it('checks every new connection again, also for requests that share an agent', async () => {
    // The server closes each connection, so the second request needs a new
    // one, and by then the name resolves to an address the policy refuses.
    let calls = 0
    const shared: PinnedFetchDeps = {
      resolve: async () => {
        calls += 1
        return calls === 1 ? [v4('127.0.0.1')] : [v4('127.0.0.2')]
      },
      isPublicAddress: (address) => address === '127.0.0.1',
    }
    expect(await (await pinnedFetch(`http://gw.test:${port}/close`, {}, shared)).text()).toBe('closed')
    await expect(pinnedFetch(`http://gw.test:${port}/close`, {}, shared)).rejects.toBeInstanceOf(GatewayUrlError)
    expect(calls).toBe(2)
    expect(hits.map((h) => h.url)).toEqual(['/close'])
  })

  it('refuses a name that resolves to loopback under the real policy and never connects', async () => {
    const resolve = vi.fn(async () => [v4('127.0.0.1')])
    await expect(pinnedFetch(`http://rebind.test:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(connections).toBe(0)
    expect(hits).toHaveLength(0)
  })

  it('refuses a mixed answer under the real policy and never connects', async () => {
    const resolve = vi.fn(async () => [v4('93.184.216.34'), v4('127.0.0.1')])
    await expect(pinnedFetch(`http://mixed.test:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(connections).toBe(0)
    expect(hits).toHaveLength(0)
  })

  it('runs production requests through the pinned lookup: localhost is refused before any connection', async () => {
    // No dependencies: the shared production agent, the system resolver and the
    // real policy. Without the pinned agent, fetch would reach the local server.
    await expect(pinnedFetch(`http://localhost:${port}/`)).rejects.toBeInstanceOf(GatewayUrlError)
    expect(connections).toBe(0)
  })

  it('checks an IP literal itself, since no lookup runs for it', async () => {
    const resolve = vi.fn()
    await expect(pinnedFetch(`http://127.0.0.1:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    await expect(pinnedFetch(`http://[::1]:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    await expect(pinnedFetch(`http://[::ffff:7f00:1]:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(resolve).not.toHaveBeenCalled()
    expect(connections).toBe(0)
  })

  it('connects to a public-by-policy IP literal without a lookup', async () => {
    const resolve = vi.fn()
    const res = await pinnedFetch(`http://127.0.0.1:${port}/lit`, {}, { resolve, isPublicAddress: allowAll })
    expect(await res.json()).toEqual({ ok: true, path: '/lit' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects a scheme other than http and https', async () => {
    await expect(pinnedFetch('file:///etc/passwd')).rejects.toBeInstanceOf(GatewayUrlError)
    await expect(pinnedFetch('ftp://gw.test/')).rejects.toBeInstanceOf(GatewayUrlError)
  })

  it('sends method, headers and body', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/p`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'accept-encoding': 'identity' },
      body: '{"a":"é"}',
    }, { resolve, isPublicAddress: allowAll })
    await res.text()
    expect(hits[0].method).toBe('POST')
    expect(hits[0].body).toBe('{"a":"é"}')
    expect(hits[0].headers['content-length']).toBe(String(Buffer.byteLength('{"a":"é"}')))
    expect(hits[0].headers.authorization).toBe('Bearer t')
    expect(hits[0].headers['content-type']).toBe('application/json')
    expect(hits[0].headers['accept-encoding']).toBe('identity')
  })

  it('returns a redirect as it is and never follows it', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/redirect`, {}, { resolve, isPublicAddress: allowAll })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/internal-target')
    expect(hits.map((h) => h.url)).toEqual(['/redirect'])
  })

  it('answers a body-less status with a null body and a HEAD request the same way', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const empty = await pinnedFetch(`http://gw.test:${port}/empty`, {}, { resolve, isPublicAddress: allowAll })
    expect(empty.status).toBe(204)
    expect(empty.body).toBeNull()
    const head = await pinnedFetch(`http://gw.test:${port}/x`, { method: 'HEAD' }, { resolve, isPublicAddress: allowAll })
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
  })

  it('decodes a gzip answer', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/gzip`, {}, { resolve, isPublicAddress: allowAll })
    expect(await res.text()).toBe('zipped line\n')
  })

  it('keeps repeated response headers', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/cookies`, {}, { resolve, isPublicAddress: allowAll })
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    await res.text()
  })

  it('streams the body and stops when the caller aborts', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const controller = new AbortController()
    const res = await pinnedFetch(`http://gw.test:${port}/slow`, { signal: controller.signal }, { resolve, isPublicAddress: allowAll })
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('first\n')
    controller.abort()
    await expect(reader.read()).rejects.toThrow()
  })

  it('fails with the resolver error as the cause when the name does not resolve', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    const err = await pinnedFetch(`http://gone.test:${port}/`, {}, { resolve: async () => { throw failure } })
      .catch((e: unknown) => e)
    // Only a policy rejection is passed on as itself; other failures stay fetch's.
    expect(err).toBeInstanceOf(TypeError)
    expect((err as TypeError).cause).toBe(failure)
  })
})

// ── https ─────────────────────────────────────────────────────────────────────
//
// A local TLS server presents a self-signed certificate for the name gw.test
// (valid 2000-2100). It is test material that protects nothing; the tests pass
// it as the only trusted authority.

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBbjCCARSgAwIBAgIUf8jzXL/0Kw+evPAEy154BKhH5OcwCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHZ3cudGVzdDAgFw0wMDAxMDEwMDAwMDBaGA8yMTAwMDEwMTAw
MDAwMFowEjEQMA4GA1UEAwwHZ3cudGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEH
A0IABCb7bUakgAMd2rBlFszUkdTUPCOomMqjY9Jfn/vgjHa7qF8hAOcS9obA9Zy7
BT0QLaWKr43yFHn9cyGHJHfumFajRjBEMB0GA1UdDgQWBBQ5eKn57Eg0livyBjMr
sRCRDrqF0jAPBgNVHRMBAf8EBTADAQH/MBIGA1UdEQQLMAmCB2d3LnRlc3QwCgYI
KoZIzj0EAwIDSAAwRQIhAItSdlofaEFEhifxb+xoz3xBgiTeEOj62ge11yA0pgTe
AiBpr1g32nExUxXwQeb4ylXRV9JngeaBrkesBay5Dl1Mjg==
-----END CERTIFICATE-----
`
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgnCyaIYYSy7kQj/AO
HkmlmhED/4Ev/jFKGyKjXj7P8RqhRANCAAQm+21GpIADHdqwZRbM1JHU1DwjqJjK
o2PSX5/74Ix2u6hfIQDnEvaGwPWcuwU9EC2liq+N8hR5/XMhhyR37phW
-----END PRIVATE KEY-----
`

describe('pinnedFetch, https', () => {
  let server: https.Server
  let port: number
  const serverNames: unknown[] = []
  const resolve = async () => [v4('127.0.0.1')]

  beforeAll(async () => {
    server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => res.end(`tls ok ${req.headers.host}`))
    server.on('secureConnection', (socket) => serverNames.push(socket.servername))
    server.on('tlsClientError', (_err, socket) => serverNames.push(socket.servername))
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  })

  afterEach(() => { serverNames.length = 0 })

  it('connects to the checked address, sends the host name as SNI and verifies the certificate against it', async () => {
    const res = await pinnedFetch(`https://gw.test:${port}/x`, {}, { resolve, isPublicAddress: allowAll, ca: [TEST_CERT] })
    expect(await res.text()).toBe(`tls ok gw.test:${port}`)
    expect(serverNames).toEqual(['gw.test'])
  })

  it('refuses a certificate that does not name the requested host, even at the checked address', async () => {
    const err = await pinnedFetch(`https://other.test:${port}/`, {}, { resolve, isPublicAddress: allowAll, ca: [TEST_CERT] })
      .catch((e: unknown) => e)
    expect(causeCode(err)).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it('refuses a certificate that no trusted authority signed', async () => {
    const err = await pinnedFetch(`https://gw.test:${port}/`, {}, { resolve, isPublicAddress: allowAll })
      .catch((e: unknown) => e)
    expect(causeCode(err)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
  })
})

// ── scripted gateways ─────────────────────────────────────────────────────────
//
// A raw TCP server stands in for a misbehaving gateway: it runs a script on the
// connection once the request arrives. Limits are a few hundred milliseconds;
// undici checks them on a coarse timer, so a limit fires within about a second.

function scriptedServer() {
  const sockets = new Set<net.Socket>()
  const closed = new WeakSet<net.Socket>()
  const state = {
    port: 0,
    script: (() => { /* set by each test */ }) as (socket: net.Socket) => void,
    /** The connection the latest request came in on. */
    last: undefined as net.Socket | undefined,
    /** Whether that connection is closed (a late close of an earlier one does not count). */
    lastClosed: () => state.last !== undefined && closed.has(state.last),
  }
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => { /* the client destroys the connection */ })
    socket.on('close', () => { sockets.delete(socket); closed.add(socket) })
    socket.once('data', () => {
      state.last = socket
      state.script(socket)
    })
  })
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    state.port = (server.address() as AddressInfo).port
  })
  afterAll(async () => {
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((done) => server.close(() => done()))
  })
  afterEach(() => { state.last = undefined })
  return state
}

const resolveLocal = async () => [v4('127.0.0.1')]

describe('pinnedFetch, time limits', () => {
  const gw = scriptedServer()
  const deps = (timeouts: Partial<typeof DEFAULT_PINNED_TIMEOUTS>): PinnedFetchDeps =>
    ({ resolve: resolveLocal, isPublicAddress: allowAll, timeouts })
  const url = () => `http://gw.test:${gw.port}/`

  it('defaults to the limits of the global fetch, none above 300 s', () => {
    expect(DEFAULT_PINNED_TIMEOUTS).toEqual({ connectMs: 10_000, headersMs: 300_000, bodyMs: 300_000 })
  })

  it('rejects, and closes the socket, when the server never sends the response headers', async () => {
    gw.script = () => { /* accept the request, never answer */ }
    const started = Date.now()
    const failure = await pinnedFetch(url(), {}, deps({ headersMs: 200 })).catch((e: unknown) => e)
    expect(causeCode(failure)).toBe('UND_ERR_HEADERS_TIMEOUT')
    expect(Date.now() - started).toBeLessThan(4000)
    await until(gw.lastClosed)
    expect(gw.lastClosed()).toBe(true)
  }, 10_000)

  it('rejects when the name resolves too slowly (the connect limit includes the lookup)', async () => {
    const never = () => new Promise<ResolvedAddress[]>(() => { /* resolver hangs */ })
    const started = Date.now()
    const failure = await pinnedFetch(url(), {}, { resolve: never, isPublicAddress: allowAll, timeouts: { connectMs: 200 } })
      .catch((e: unknown) => e)
    expect(causeCode(failure)).toBe('UND_ERR_CONNECT_TIMEOUT')
    expect(Date.now() - started).toBeLessThan(4000)
  }, 10_000)

  it('completes when the answer arrives within the headers limit', async () => {
    gw.script = (socket) => { socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok') }
    const res = await pinnedFetch(url(), {}, deps({ connectMs: 5000, headersMs: 2000 }))
    expect(await res.text()).toBe('ok')
  })

  it('fails the body read, and closes the socket, when the server goes silent after the first chunk', async () => {
    gw.script = (socket) => { socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n') }
    const res = await pinnedFetch(url(), {}, deps({ bodyMs: 200 }))
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('first')
    const failure = await reader.read().catch((e: unknown) => e)
    expect(causeCode(failure)).toBe('UND_ERR_BODY_TIMEOUT')
    await until(gw.lastClosed)
    expect(gw.lastClosed()).toBe(true)
  }, 10_000)

  it('fails a gzip body read the same way when the server goes silent', async () => {
    const gz = zlib.gzipSync('x'.repeat(100_000))
    gw.script = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n')
      socket.write(gz.subarray(0, 40))
    }
    const res = await pinnedFetch(url(), {}, deps({ bodyMs: 200 }))
    const failure = await res.text().catch((e: unknown) => e)
    expect(causeCode(failure)).toBe('UND_ERR_BODY_TIMEOUT')
  }, 10_000)

  it('treats the body limit as an idle limit: a slow trickle that keeps sending is not cut off', async () => {
    gw.script = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n')
      let n = 0
      const tick = setInterval(() => {
        n += 1
        if (n > 15) { clearInterval(tick); socket.end('0\r\n\r\n'); return }
        socket.write('1\r\nx\r\n')
      }, 100)
      socket.on('close', () => clearInterval(tick))
    }
    // 15 chunks over about 1.5 s with a 200 ms idle limit.
    const res = await pinnedFetch(url(), {}, deps({ bodyMs: 200 }))
    expect(await res.text()).toBe('x'.repeat(15))
  }, 10_000)

  it('does not count time while the caller is not reading (backpressure)', async () => {
    const chunk = 'a'.repeat(1024)
    gw.script = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 4194304\r\n\r\n')
      let sent = 0
      const pump = () => {
        while (sent < 4096) {
          sent += 1
          if (!socket.write(chunk)) { socket.once('drain', pump); return }
        }
        socket.end()
      }
      pump()
    }
    const res = await pinnedFetch(url(), {}, deps({ bodyMs: 200 }))
    const reader = res.body!.getReader()
    const first = await reader.read()
    // The reader stops pulling for well over the limit; the stream must stay usable.
    await new Promise((r) => setTimeout(r, 2000))
    let bytes = first.value!.length
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
    }
    expect(bytes).toBe(4096 * 1024)
  }, 10_000)

  it('still honours the caller AbortSignal while waiting for headers', async () => {
    gw.script = () => { /* never answer */ }
    const controller = new AbortController()
    const promise = pinnedFetch(url(), { signal: controller.signal }, deps({ headersMs: 5000 }))
    setTimeout(() => controller.abort(), 100)
    const failure = await promise.catch((e: unknown) => e)
    expect((failure as Error).name).toBe('AbortError')
  })
})

// ── settlement ────────────────────────────────────────────────────────────────
//
// Whatever a gateway sends, the request settles: the call resolves or rejects,
// and a body read that starts settles too. Each case runs under a hard test
// timeout, so a hang fails the case instead of blocking the suite.

function exposeGc(): () => void {
  v8.setFlagsFromString('--expose-gc')
  return vm.runInNewContext('gc') as () => void
}

describe('pinnedFetch, every answer settles', () => {
  const gw = scriptedServer()
  const BOUND_MS = 5000
  const LIMITS = { connectMs: 1000, headersMs: 300, bodyMs: 300 }
  const run = (timeouts: Partial<typeof DEFAULT_PINNED_TIMEOUTS> = LIMITS) =>
    pinnedFetch(`http://gw.test:${gw.port}/`, {}, { resolve: resolveLocal, isPublicAddress: allowAll, timeouts })

  /** One line per outcome: `rejected <cause>`, or `<status> read` / `<status> failed <cause>` for the body. */
  async function outcome(): Promise<string> {
    const call = await within(run().then((res) => ({ res }), (error: unknown) => ({ error })), BOUND_MS)
    if (call === 'HUNG') return 'request HUNG'
    if ('error' in call) return `rejected ${causeCode(call.error)}`
    const body = await within(call.res.text().then(() => 'read', (error: unknown) => `failed ${causeCode(error)}`), BOUND_MS)
    return body === 'HUNG' ? `${call.res.status} body HUNG` : `${call.res.status} ${body}`
  }

  const head = (status: string, headers = '') => `HTTP/1.1 ${status}\r\n${headers}`

  it.each<[string, (socket: net.Socket) => void, string]>([
    ['the connection closes before any header', (s) => s.destroy(), 'rejected UND_ERR_SOCKET'],
    [
      '101 with Upgrade and Connection: Upgrade',
      (s) => s.write(head('101 Switching Protocols', 'Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n')),
      'rejected UND_ERR_SOCKET',
    ],
    ['101 without an Upgrade header', (s) => s.write(head('101 Switching Protocols', '\r\n')), 'rejected UND_ERR_HEADERS_TIMEOUT'],
    ['an unsolicited 100 Continue', (s) => s.write(head('100 Continue', '\r\n')), 'rejected UND_ERR_SOCKET'],
    ['status 600', (s) => s.end(head('600 Nope', 'Content-Length: 2\r\nConnection: close\r\n\r\nok')), '600 read'],
    ['status 999', (s) => s.end(head('999 Nope', 'Content-Length: 2\r\nConnection: close\r\n\r\nok')), '999 read'],
    ['a control byte in the reason phrase', (s) => s.end(head('200 O\x01K', 'Content-Length: 2\r\nConnection: close\r\n\r\nok')), '200 read'],
    ['DEL in the reason phrase', (s) => s.end(head('200 O\x7fK', 'Content-Length: 2\r\nConnection: close\r\n\r\nok')), '200 read'],
    ['no answer at all', () => { /* stall before the headers */ }, 'rejected UND_ERR_HEADERS_TIMEOUT'],
    ['silence in the middle of the body', (s) => s.write(head('200 OK', 'Content-Length: 100\r\n\r\nfirst')), '200 failed UND_ERR_BODY_TIMEOUT'],
    [
      'a reset in the middle of the body',
      (s) => { s.write(head('200 OK', 'Content-Length: 100\r\n\r\nfirst')); setTimeout(() => s.resetAndDestroy(), 50) },
      '200 failed ECONNRESET',
    ],
    ['the connection ends in the middle of the body', (s) => s.end(head('200 OK', 'Content-Length: 100\r\n\r\nfirst')), '200 failed UND_ERR_SOCKET'],
  ])('settles when the gateway sends %s', async (_label, script, expected) => {
    gw.script = script
    expect(await outcome()).toBe(expected)
  }, 15_000)

  it('passes a valid reason phrase through', async () => {
    gw.script = (s) => s.end(head('503 Gateway Down', 'Content-Length: 0\r\nConnection: close\r\n\r\n'))
    const res = await run()
    expect(res.status).toBe(503)
    expect(res.statusText).toBe('Gateway Down')
  })

  // A large non-OK body that nobody reads fills fetch's buffer, which pauses the
  // body limit; the connection is held until the response is collected or its
  // body is cancelled. The body limit is set high so only those can release it.
  const bigErrorBody = (s: net.Socket) => {
    s.write(head('500 Internal Server Error', 'Content-Length: 10000000\r\n\r\n'))
    s.write(Buffer.alloc(1_000_000, 97))
  }

  it('releases the connection of a non-OK answer whose body nobody reads once the response is collected', async () => {
    gw.script = bigErrorBody
    // Nothing keeps the response once this call returns.
    expect(await (async () => (await run({ bodyMs: 60_000 })).status)()).toBe(500)
    const gc = exposeGc()
    const started = Date.now()
    while (!gw.lastClosed() && Date.now() - started < BOUND_MS) {
      gc()
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(gw.lastClosed()).toBe(true)
  }, 15_000)

  it('releases the connection at once when the caller cancels an unread body', async () => {
    gw.script = bigErrorBody
    const res = await run({ bodyMs: 60_000 })
    await res.body?.cancel()
    await until(gw.lastClosed)
    expect(gw.lastClosed()).toBe(true)
  }, 15_000)
})
