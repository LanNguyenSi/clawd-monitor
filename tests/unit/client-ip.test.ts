import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import type { IncomingMessage } from 'http'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createServer, type ServerResponse } from 'http'
import { connect, type AddressInfo } from 'net'
import {
  PEER_ADDR_HEADER,
  UNKNOWN_CLIENT_KEY,
  getClientKey,
  getClientKeys,
  normalizeIp,
  parseClient,
  parseTrustedProxyHops,
  stampPeerAddress,
  withPeerAddress,
} from '@/lib/client-ip'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('parseTrustedProxyHops', () => {
  it.each([
    ['absent', undefined, 0, false],
    ['empty', '', 0, false],
    ['whitespace only', '   ', 0, false],
    ['0', '0', 0, false],
    ['1', '1', 1, false],
    ['2', '2', 2, false],
    ['padded', ' 2 ', 2, false],
    ['leading zero', '01', 1, false],
    ['text', 'abc', 0, true],
    ['negative', '-1', 0, true],
    ['plus sign', '+1', 0, true],
    ['fraction', '1.5', 0, true],
    ['exponent', '1e2', 0, true],
    ['hex', '0x1', 0, true],
    ['two numbers', '1 2', 0, true],
    ['too large to be exact', '99999999999999999999', 0, true],
  ])('%s -> hops %s', (_name, raw, hops, invalid) => {
    expect(parseTrustedProxyHops(raw)).toEqual({ hops, invalid })
  })
})

describe('getTrustedProxyHops', () => {
  async function load() {
    return (await import('@/lib/client-ip')).getTrustedProxyHops
  }

  it('reads the value from the environment it is given', async () => {
    const get = await load()
    expect(get({ TRUSTED_PROXY_HOPS: '2' })).toBe(2)
    expect(get({})).toBe(0)
  })

  it('reads process.env by default', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    const get = await load()
    expect(get()).toBe(1)
  })

  it('treats an invalid value as 0 and logs once per process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = await load()
    expect(get({ TRUSTED_PROXY_HOPS: 'many' })).toBe(0)
    expect(get({ TRUSTED_PROXY_HOPS: '-3' })).toBe(0)
    expect(get({ TRUSTED_PROXY_HOPS: 'many' })).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('TRUSTED_PROXY_HOPS')
  })

  it('does not log for absent, empty or valid values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = await load()
    for (const v of [undefined, '', '0', '1']) get({ TRUSTED_PROXY_HOPS: v })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('normalizeIp', () => {
  it.each([
    ['plain IPv4', '203.0.113.7', '203.0.113.7'],
    ['IPv4 with surrounding spaces', '  203.0.113.7 ', '203.0.113.7'],
    ['IPv4 with port', '203.0.113.7:51234', '203.0.113.7'],
    ['IPv4-mapped IPv6', '::ffff:203.0.113.7', '203.0.113.7'],
    ['IPv4-mapped IPv6 in hex form', '::ffff:cb00:7107', '203.0.113.7'],
    ['IPv6 -> /64 prefix', '2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['IPv6 compressed', '2001:db8::1', '2001:db8:0:0::/64'],
    ['IPv6 upper case', '2001:DB8::1', '2001:db8:0:0::/64'],
    ['IPv6 in the same /64 gets the same key', '2001:db8:0:0:ffff:ffff:ffff:ffff', '2001:db8:0:0::/64'],
    ['IPv6 bracketed', '[2001:db8::1]', '2001:db8:0:0::/64'],
    ['IPv6 bracketed with port', '[2001:db8::1]:443', '2001:db8:0:0::/64'],
    ['IPv6 with zone id', 'fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['IPv6 loopback', '::1', '0:0:0:0::/64'],
    ['IPv6 trailing ::', '2001:db8::', '2001:db8:0:0::/64'],
    ['IPv6 with embedded IPv4 tail', '64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
    ['IPv6 with no ::', '1:2:3:4:5:6:7:8', '1:2:3:4::/64'],
    ['IPv4 zero address', '0.0.0.0', '0.0.0.0'],
    ['IPv4 with a single zero octet', '10.0.0.255', '10.0.0.255'],
    ['IPv6 with leading zeros in groups', '2001:0db8:0000:0001::0001', '2001:db8:0:1::/64'],
  ])('%s', (_name, raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected)
  })

  it('different /64s get different keys', () => {
    expect(normalizeIp('2001:db8:0:1::1')).not.toBe(normalizeIp('2001:db8:0:2::1'))
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['hostname', 'evil.example.com'],
    ['IPv4 with a leading zero', '010.1.1.1'],
    ['IPv6 with a path character', '2001:db8::1/64'],
    ['IPv6 group too long', '2001:db8::12345'],
    ['IPv4 with a port that is not a number', '1.2.3.4:http'],
    ['unknown token', 'unknown'],
    ['too many IPv4 octets', '1.2.3.4.5'],
    ['octet out of range', '256.1.1.1'],
    ['garbage', 'drop table;'],
    ['IPv6 with two ::', '1::2::3'],
    ['brackets around IPv4', '[1.2.3.4]'],
  ])('%s is not an address', (_name, raw) => {
    expect(normalizeIp(raw as string | null | undefined)).toBeNull()
  })
})

describe('stampPeerAddress', () => {
  function req(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
    return { socket: { remoteAddress }, headers: { ...headers } } as unknown as IncomingMessage
  }

  it('sets the header from the socket peer', () => {
    const r = req('198.51.100.9')
    stampPeerAddress(r)
    expect(r.headers[PEER_ADDR_HEADER]).toBe('198.51.100.9')
  })

  it('overwrites a header the client sent', () => {
    const r = req('198.51.100.9', { [PEER_ADDR_HEADER]: '1.1.1.1' })
    stampPeerAddress(r)
    expect(r.headers[PEER_ADDR_HEADER]).toBe('198.51.100.9')
  })

  it('removes a client-sent header when the socket has no peer address', () => {
    const r = req(undefined, { [PEER_ADDR_HEADER]: '1.1.1.1' })
    stampPeerAddress(r)
    expect(r.headers[PEER_ADDR_HEADER]).toBeUndefined()
  })

  it('leaves the header unset when there is no peer address and no client value', () => {
    const r = req(undefined)
    stampPeerAddress(r)
    expect(PEER_ADDR_HEADER in r.headers).toBe(false)
  })

  it('copes with a request that has no socket', () => {
    const r = { headers: {} } as unknown as IncomingMessage
    expect(() => stampPeerAddress(r)).not.toThrow()
  })
})

describe('getClientKey', () => {
  const PEER = '10.0.0.9'
  function h(xff?: string | string[], peer: string | null = PEER) {
    const headers = new Headers()
    if (peer !== null) headers.set(PEER_ADDR_HEADER, peer)
    if (xff !== undefined) for (const line of [xff].flat()) headers.append('x-forwarded-for', line)
    return headers
  }

  describe('hops 0 (default): X-Forwarded-For is ignored', () => {
    it('XFF absent -> the peer', () => {
      expect(getClientKey(h(), 0)).toBe(PEER)
    })
    it('XFF with one entry -> the peer', () => {
      expect(getClientKey(h('203.0.113.7'), 0)).toBe(PEER)
    })
    it('XFF with several entries -> the peer', () => {
      expect(getClientKey(h('203.0.113.7, 198.51.100.1, 192.0.2.4'), 0)).toBe(PEER)
    })
    it('a forged XFF cannot move the bucket', () => {
      expect(getClientKey(h('1.1.1.1'), 0)).toBe(getClientKey(h('2.2.2.2'), 0))
    })
    it('no peer header -> the shared bucket, even with XFF', () => {
      expect(getClientKey(h('203.0.113.7', null), 0)).toBe(UNKNOWN_CLIENT_KEY)
    })
    it('an unusable peer header -> the shared bucket', () => {
      expect(getClientKey(h('203.0.113.7', 'not-an-ip'), 0)).toBe(UNKNOWN_CLIENT_KEY)
    })
    it('an IPv4-mapped peer is keyed as IPv4', () => {
      expect(getClientKey(h(undefined, '::ffff:10.0.0.9'), 0)).toBe('10.0.0.9')
    })
  })

  describe('hops 1: the last XFF entry', () => {
    it('XFF absent -> the peer', () => {
      expect(getClientKey(h(), 1)).toBe(PEER)
    })
    it('XFF with one entry -> that entry', () => {
      expect(getClientKey(h('203.0.113.7'), 1)).toBe('203.0.113.7')
    })
    it('XFF with several entries -> the rightmost', () => {
      expect(getClientKey(h('9.9.9.9, 198.51.100.1, 203.0.113.7'), 1)).toBe('203.0.113.7')
    })
    it('a spoofed leftmost entry does not change the key', () => {
      const a = getClientKey(h('203.0.113.7'), 1)
      const b = getClientKey(h('1.2.3.4, 203.0.113.7'), 1)
      const c = getClientKey(h('5.6.7.8, 9.9.9.9, 203.0.113.7'), 1)
      expect([a, b, c]).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7'])
    })
    it('extra whitespace around entries is ignored', () => {
      expect(getClientKey(h('  9.9.9.9 ,\t203.0.113.7  '), 1)).toBe('203.0.113.7')
    })
    it('an IPv6 entry is keyed by its /64', () => {
      expect(getClientKey(h('9.9.9.9, 2001:db8::7'), 1)).toBe('2001:db8:0:0::/64')
    })
    it('an IPv4-mapped entry is keyed as IPv4', () => {
      expect(getClientKey(h('::ffff:203.0.113.7'), 1)).toBe('203.0.113.7')
    })
    it('repeated header lines count as one list, the last line is the rightmost', () => {
      expect(getClientKey(h(['9.9.9.9', '198.51.100.1', '203.0.113.7']), 1)).toBe('203.0.113.7')
    })
    it('a trailing comma leaves an empty last entry -> the peer, never an earlier entry', () => {
      expect(getClientKey(h('9.9.9.9,'), 1)).toBe(PEER)
    })
    it('a last entry that is not an address -> the peer', () => {
      expect(getClientKey(h('203.0.113.7, evil'), 1)).toBe(PEER)
    })
    it('an empty header value -> the peer', () => {
      expect(getClientKey(h(''), 1)).toBe(PEER)
    })
    it('no entry and no peer header -> the shared bucket', () => {
      expect(getClientKey(h(undefined, null), 1)).toBe(UNKNOWN_CLIENT_KEY)
    })
  })

  describe('hops 2: the second entry from the right', () => {
    it('XFF with two entries -> the left one', () => {
      expect(getClientKey(h('203.0.113.7, 198.51.100.1'), 2)).toBe('203.0.113.7')
    })
    it('XFF with three entries -> the middle one, not the leftmost', () => {
      expect(getClientKey(h('9.9.9.9, 203.0.113.7, 198.51.100.1'), 2)).toBe('203.0.113.7')
    })
    it('XFF with one entry (fewer than hops) -> the peer, not that entry', () => {
      expect(getClientKey(h('203.0.113.7'), 2)).toBe(PEER)
    })
    it('XFF absent (fewer than hops) -> the peer', () => {
      expect(getClientKey(h(), 2)).toBe(PEER)
    })
  })

  it('a hop count larger than the list falls back to the peer', () => {
    expect(getClientKey(h('1.1.1.1, 2.2.2.2'), 50)).toBe(PEER)
  })
})

describe('parseClient', () => {
  it('IPv4 has no parent', () => {
    expect(parseClient('203.0.113.7')).toEqual({ key: '203.0.113.7' })
  })

  it('IPv4-mapped IPv6 has no parent', () => {
    expect(parseClient('::ffff:203.0.113.7')).toEqual({ key: '203.0.113.7' })
  })

  it('IPv6 has its /64 as key and its /48 as parent', () => {
    expect(parseClient('2001:db8:1:2:3:4:5:6')).toEqual({ key: '2001:db8:1:2::/64', parent: '2001:db8:1::/48' })
  })

  it('two /64s of one /48 share the parent', () => {
    expect(parseClient('2001:db8:1:2::1')?.parent).toBe(parseClient('2001:db8:1:ffff::1')?.parent)
    expect(parseClient('2001:db8:1:2::1')?.key).not.toBe(parseClient('2001:db8:1:ffff::1')?.key)
  })

  it('different /48s have different parents', () => {
    expect(parseClient('2001:db8:1::1')?.parent).not.toBe(parseClient('2001:db8:2::1')?.parent)
  })

  it('is null for something that is not an address', () => {
    expect(parseClient('nope')).toBeNull()
    expect(parseClient(null)).toBeNull()
  })
})

describe('getClientKeys', () => {
  const h = (peer: string | null, xff?: string) => {
    const headers = new Headers()
    if (peer !== null) headers.set(PEER_ADDR_HEADER, peer)
    if (xff !== undefined) headers.set('x-forwarded-for', xff)
    return headers
  }

  it('hops 0: the peer, with its parent for IPv6', () => {
    expect(getClientKeys(h('2001:db8:1:2::9', '1.2.3.4'), 0)).toEqual({ key: '2001:db8:1:2::/64', parent: '2001:db8:1::/48' })
  })

  it('hops 1: the trusted entry, with its parent for IPv6', () => {
    expect(getClientKeys(h('10.0.0.9', '9.9.9.9, 2001:db8:5:6::1'), 1)).toEqual({ key: '2001:db8:5:6::/64', parent: '2001:db8:5::/48' })
  })

  it('hops 1 with a bad entry: the peer, with its own parent', () => {
    expect(getClientKeys(h('2001:db8:1:2::9', 'evil'), 1)).toEqual({ key: '2001:db8:1:2::/64', parent: '2001:db8:1::/48' })
  })

  it('no peer: the shared key without parent', () => {
    expect(getClientKeys(h(null), 0)).toEqual({ key: UNKNOWN_CLIENT_KEY })
  })

  it('the list needs at least N entries: more than N is fine and only the last N count', () => {
    expect(getClientKeys(h('10.0.0.9', '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4'), 2)).toEqual({ key: '3.3.3.3' })
  })
})

describe('withPeerAddress', () => {
  it('stamps the request before the listener runs', () => {
    const seen: unknown[] = []
    const req = { socket: { remoteAddress: '198.51.100.9' }, headers: { [PEER_ADDR_HEADER]: '1.1.1.1' } } as unknown as IncomingMessage
    withPeerAddress((r, res) => seen.push(r.headers[PEER_ADDR_HEADER], res))(req, 'res' as unknown as ServerResponse)
    expect(seen).toEqual(['198.51.100.9', 'res'])
  })

  it('deletes a client value before the listener runs when the socket has no peer address', () => {
    const seen: unknown[] = []
    const req = { socket: {}, headers: { [PEER_ADDR_HEADER]: '1.1.1.1' } } as unknown as IncomingMessage
    withPeerAddress((r) => seen.push(r.headers[PEER_ADDR_HEADER]))(req, {} as ServerResponse)
    expect(seen).toEqual([undefined])
  })

  // The real thing: a node http server, raw requests that name the header in
  // several letter cases and more than once.
  describe('on a real http server', () => {
    const seen: Array<string | string[] | undefined> = []
    const server = createServer(
      withPeerAddress((req, res) => {
        seen.push(req.headers[PEER_ADDR_HEADER])
        res.end('ok')
      }),
    )
    let port = 0
    beforeAll(async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
      port = (server.address() as AddressInfo).port
    })
    afterAll(async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    })

    function raw(headerLines: string[]): Promise<void> {
      return new Promise((resolve, reject) => {
        const sock = connect(port, '127.0.0.1', () => {
          sock.write(['GET / HTTP/1.1', 'Host: x', ...headerLines, 'Connection: close', '', ''].join('\r\n'))
        })
        sock.on('data', () => {})
        sock.on('close', () => resolve())
        sock.on('error', reject)
      })
    }

    it('replaces a client-sent header, in any case and repeated, with the socket peer', async () => {
      seen.length = 0
      await raw([
        'x-clawd-peer-addr: 1.1.1.1',
        'X-Clawd-Peer-Addr: 2.2.2.2',
        'X-CLAWD-PEER-ADDR: 3.3.3.3, 4.4.4.4',
      ])
      expect(seen).toEqual(['127.0.0.1'])
    })

    it('stamps the peer on a request that sent no such header', async () => {
      seen.length = 0
      await raw([])
      expect(seen).toEqual(['127.0.0.1'])
    })
  })
})

describe('server.ts wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../server.ts'), 'utf8')

  it('imports withPeerAddress', () => {
    expect(src).toMatch(/import \{ withPeerAddress \} from '\.\/src\/lib\/client-ip\.js'/)
  })

  it('creates its one request server with the stamping wrapper around the handler', () => {
    expect(src).toMatch(/createServer\(\s*withPeerAddress\(\(req, res\) => \{[\s\S]*?void handle\(req, res, parsedUrl\)/)
  })
})
