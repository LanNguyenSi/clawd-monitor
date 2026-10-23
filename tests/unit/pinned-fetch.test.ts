/**
 * Pinned-address fetch (src/lib/pinned-fetch.ts).
 *
 * No real DNS and no outside network: the resolver is a stub and the only
 * connections are to a server on 127.0.0.1 started by the test. The address
 * policy is replaced by "everything is public" only where a test has to reach
 * that local server; the policy tests use the real one.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import {
  createPinnedLookup,
  pinnedFetch,
  DEFAULT_PINNED_TIMEOUTS,
  PinnedFetchTimeoutError,
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

describe('pinnedFetch, local server', () => {
  let server: http.Server
  let port: number
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => { hits.length = 0 })

  const allowAll = () => true

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

  it('does not reuse a connection made earlier: each request resolves and checks again', async () => {
    const resolve = vi.fn(async () => [v4('127.0.0.1')])
    await (await pinnedFetch(`http://gw.test:${port}/a`, {}, { resolve, isPublicAddress: allowAll })).text()
    await (await pinnedFetch(`http://gw.test:${port}/b`, {}, { resolve, isPublicAddress: allowAll })).text()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(hits.map((h) => h.url)).toEqual(['/a', '/b'])
  })

  it('refuses a name that resolves to loopback under the real policy and never connects', async () => {
    const resolve = vi.fn(async () => [v4('127.0.0.1')])
    await expect(pinnedFetch(`http://rebind.test:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(hits).toHaveLength(0)
  })

  it('refuses a mixed answer under the real policy and never connects', async () => {
    const resolve = vi.fn(async () => [v4('93.184.216.34'), v4('127.0.0.1')])
    await expect(pinnedFetch(`http://mixed.test:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(hits).toHaveLength(0)
  })

  it('checks an IP literal itself, since no lookup runs for it', async () => {
    const resolve = vi.fn()
    await expect(pinnedFetch(`http://127.0.0.1:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    await expect(pinnedFetch(`http://[::1]:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    await expect(pinnedFetch(`http://[::ffff:7f00:1]:${port}/`, {}, { resolve })).rejects.toBeInstanceOf(GatewayUrlError)
    expect(resolve).not.toHaveBeenCalled()
    expect(hits).toHaveLength(0)
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

  it('sends method, headers and body, and lets the caller override accept-encoding', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    await pinnedFetch(`http://gw.test:${port}/p`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":"é"}',
    }, { resolve, isPublicAddress: allowAll })
    expect(hits[0].method).toBe('POST')
    expect(hits[0].body).toBe('{"a":"é"}')
    expect(hits[0].headers['content-length']).toBe(String(Buffer.byteLength('{"a":"é"}')))
    expect(hits[0].headers.authorization).toBe('Bearer t')
    expect(hits[0].headers['content-type']).toBe('application/json')
    expect(hits[0].headers['accept-encoding']).toBe('identity')

    hits.length = 0
    await pinnedFetch(`http://gw.test:${port}/p`, { headers: { 'accept-encoding': 'gzip' } }, { resolve, isPublicAddress: allowAll })
    expect(hits[0].headers['accept-encoding']).toBe('gzip')
    expect(hits[0].headers['content-length']).toBeUndefined()
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

  it('decodes a gzip answer and drops the encoding and length headers', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/gzip`, {}, { resolve, isPublicAddress: allowAll })
    expect(await res.text()).toBe('zipped line\n')
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('keeps repeated response headers', async () => {
    const resolve = async () => [v4('127.0.0.1')]
    const res = await pinnedFetch(`http://gw.test:${port}/cookies`, {}, { resolve, isPublicAddress: allowAll })
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
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

  it('fails with the resolver error when the name does not resolve', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    await expect(pinnedFetch(`http://gone.test:${port}/`, {}, { resolve: async () => { throw failure } }))
      .rejects.toBe(failure)
  })
})

describe('pinnedFetch, https', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps the host name in the request (SNI and certificate check) and installs the lookup', async () => {
    const seen: Array<{ url: URL; options: https.RequestOptions }> = []
    vi.spyOn(https, 'request').mockImplementation(((url: URL, options: https.RequestOptions) => {
      seen.push({ url, options })
      const fake = new EventEmitter() as EventEmitter & { end: () => void }
      fake.end = () => { fake.emit('error', new Error('stop here')) }
      return fake
    }) as unknown as typeof https.request)

    await expect(pinnedFetch('https://gw.example.com:8443/logs', { method: 'GET' })).rejects.toThrow('stop here')
    expect(seen).toHaveLength(1)
    expect(seen[0].url.hostname).toBe('gw.example.com')
    expect(seen[0].url.port).toBe('8443')
    expect(typeof seen[0].options.lookup).toBe('function')
    expect(seen[0].options.agent).toBe(false)
    expect(seen[0].options.servername).toBeUndefined()
  })
})

// ── time limits and unrepresentable answers ───────────────────────────────────
//
// A raw TCP server stands in for a misbehaving gateway: it can stay silent,
// stop after the headers, or send a status line that fetch cannot represent.
// Limits are set to a few hundred milliseconds; the defaults are only pinned
// as numbers, never waited for.

describe('pinnedFetch, time limits', () => {
  type Behaviour = (socket: net.Socket) => void
  let server: net.Server
  let port: number
  let behaviour: Behaviour
  const sockets = new Set<net.Socket>()
  let closedByServerSide = 0

  beforeAll(async () => {
    server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => { /* the client destroys the connection */ })
      socket.on('close', () => { sockets.delete(socket); closedByServerSide += 1 })
      socket.once('data', () => behaviour(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => { closedByServerSide = 0 })

  const resolve = async () => [v4('127.0.0.1')]
  const allowAll = () => true
  const deps = (timeouts: Partial<typeof DEFAULT_PINNED_TIMEOUTS>) => ({ resolve, isPublicAddress: allowAll, timeouts })
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 20))
  }

  it('defaults to the limits of the global fetch it replaced, none above 300 s', () => {
    expect(DEFAULT_PINNED_TIMEOUTS).toEqual({ connectMs: 10_000, headersMs: 300_000, bodyMs: 300_000 })
  })

  it('rejects and closes the socket when the server never sends the response headers', async () => {
    behaviour = () => { /* accept the request, never answer */ }
    const started = Date.now()
    const failure = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ headersMs: 150 })).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PinnedFetchTimeoutError)
    expect((failure as Error).message).toContain('headers')
    expect(Date.now() - started).toBeLessThan(3000)
    await until(() => closedByServerSide > 0)
    expect(closedByServerSide).toBe(1)
  })

  it('rejects when the name resolves too slowly (connect limit includes the lookup)', async () => {
    const never = () => new Promise<ResolvedAddress[]>(() => { /* resolver hangs */ })
    const failure = await pinnedFetch(
      `http://gw.test:${port}/`, {}, { resolve: never, isPublicAddress: allowAll, timeouts: { connectMs: 150 } },
    ).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PinnedFetchTimeoutError)
    expect((failure as Error).message).toContain('connect')
  })

  it('completes when the answer arrives within the headers limit', async () => {
    behaviour = (socket) => { socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok') }
    const res = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ connectMs: 5000, headersMs: 2000 }))
    expect(await res.text()).toBe('ok')
  })

  it('fails the body read, and closes the socket, when the server goes silent after the first chunk', async () => {
    behaviour = (socket) => { socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n') }
    const res = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ bodyMs: 150 }))
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('first')
    const failure = await reader.read().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PinnedFetchTimeoutError)
    expect((failure as Error).message).toContain('body')
    await until(() => closedByServerSide > 0)
    expect(closedByServerSide).toBe(1)
  })

  it('fails a gzip body read with the timeout error when the server goes silent', async () => {
    const gz = zlib.gzipSync('x'.repeat(100_000))
    behaviour = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n')
      socket.write(gz.subarray(0, 40))
    }
    const res = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ bodyMs: 150 }))
    const failure = await res.text().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PinnedFetchTimeoutError)
    expect((failure as Error).message).toContain('body')
  })

  it('treats the body limit as an idle limit: a slow trickle that keeps sending is not cut off', async () => {
    behaviour = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n')
      let n = 0
      const tick = setInterval(() => {
        n += 1
        if (n > 8) { clearInterval(tick); socket.end('0\r\n\r\n'); return }
        socket.write('1\r\nx\r\n')
      }, 60)
      socket.on('close', () => clearInterval(tick))
    }
    // 8 chunks over ~480 ms with a 200 ms idle limit.
    const res = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ bodyMs: 200 }))
    expect(await res.text()).toBe('xxxxxxxx')
  })

  it('does not start the body limit while the caller is not reading (backpressure pauses it)', async () => {
    const chunk = 'a'.repeat(1024)
    behaviour = (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 4194304\r\n\r\n')
      let sent = 0
      const pump = () => {
        while (sent < 4096) {
          sent += 1
          if (!socket.write(chunk.repeat(1))) { socket.once('drain', pump); return }
        }
        socket.end()
      }
      pump()
    }
    const res = await pinnedFetch(`http://gw.test:${port}/`, {}, deps({ bodyMs: 300 }))
    const reader = res.body!.getReader()
    const first = await reader.read()
    // The reader stops pulling for longer than the idle limit; the stream must stay usable.
    await new Promise((r) => setTimeout(r, 600))
    let bytes = first.value!.length
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
    }
    expect(bytes).toBe(4096 * 1024)
  })

  it('still honours the caller AbortSignal while waiting for headers', async () => {
    behaviour = () => { /* never answer */ }
    const controller = new AbortController()
    const promise = pinnedFetch(`http://gw.test:${port}/`, { signal: controller.signal }, deps({ headersMs: 5000 }))
    setTimeout(() => controller.abort(), 100)
    const failure = await promise.catch((e: unknown) => e)
    expect(failure).not.toBeInstanceOf(PinnedFetchTimeoutError)
    expect((failure as Error).name).toBe('AbortError')
  })
})

describe('pinnedFetch, answers that fetch cannot represent', () => {
  let server: net.Server
  let port: number
  let raw = ''

  beforeAll(async () => {
    server = net.createServer((socket) => {
      socket.on('error', () => { /* the client may destroy the connection */ })
      socket.once('data', () => socket.end(raw))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const run = () =>
    pinnedFetch(`http://gw.test:${port}/`, {}, {
      resolve: async () => [v4('127.0.0.1')],
      isPublicAddress: () => true,
      timeouts: { headersMs: 2000, bodyMs: 2000 },
    })

  // Each of these used to throw inside the response listener: an uncaught
  // exception for the process and a promise that never settled.
  it.each([
    ['600', 'HTTP/1.1 600 Nope\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'],
    ['999', 'HTTP/1.1 999 Nope\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'],
    ['101', 'HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n'],
  ])('rejects a %s status with a clear error instead of hanging', async (status, answer) => {
    raw = answer
    const failure = await Promise.race([
      run().catch((e: unknown) => e),
      new Promise((r) => setTimeout(() => r('HUNG'), 3000)),
    ])
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(`unsupported HTTP status (${status})`)
  })

  it.each([
    ['a control byte', 'HTTP/1.1 200 O\x01K\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'],
    ['DEL', 'HTTP/1.1 200 O\x7fK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'],
  ])('answers with an empty status text when the reason phrase has %s', async (_label, answer) => {
    raw = answer
    const res = await Promise.race([run(), new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), 3000))])
    expect(res).not.toBe('HUNG')
    const response = res as Response
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('')
    expect(await response.text()).toBe('ok')
  })

  it('keeps a valid reason phrase', async () => {
    raw = 'HTTP/1.1 503 Gateway Down\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
    const res = await run()
    expect(res.status).toBe(503)
    expect(res.statusText).toBe('Gateway Down')
  })

  it('answers the lowest and highest representable statuses', async () => {
    raw = 'HTTP/1.1 599 Edge\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
    expect((await run()).status).toBe(599)
    raw = 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
    expect((await run()).status).toBe(200)
  })
})
