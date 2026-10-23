/**
 * Unit tests for src/lib/ws-upgrade.ts - attachUpgradeRouter
 *
 * Runs against a real http.Server on an ephemeral port with real ws clients.
 * The Next stand-in is a plain function; the regression test mimics how Next's
 * custom-server wrapper behaves (a late `upgrade` listener that ends the
 * socket) to prove the router is the only listener when Next is given a
 * separate server.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer, request, type Server } from 'http'
import type { AddressInfo } from 'net'
import type { Duplex } from 'stream'
import WebSocket, { WebSocketServer } from 'ws'
import { attachUpgradeRouter } from '@/lib/ws-upgrade'

let server: Server | undefined
let wss: WebSocketServer | undefined

afterEach(async () => {
  wss?.clients.forEach((c) => c.terminate())
  wss?.close()
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server?.closeAllConnections()
  server = undefined
  wss = undefined
})

async function start(nextUpgrade: Parameters<typeof attachUpgradeRouter>[2]) {
  server = createServer((_req, res) => res.end('ok'))
  wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws) => ws.send('hello'))
  attachUpgradeRouter(server, wss, nextUpgrade)
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return (server.address() as AddressInfo).port
}

function get(port: number) {
  return new Promise<void>((resolve, reject) => {
    request({ port, host: '127.0.0.1', path: '/api/health' }, (res) => {
      res.resume()
      res.on('end', resolve)
    })
      .on('error', reject)
      .end()
  })
}

function connect(port: number, path: string) {
  return new Promise<{ msg?: string; closed?: number; error?: boolean }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('message', (d) => {
      resolve({ msg: String(d) })
      ws.close()
    })
    ws.on('error', () => resolve({ error: true }))
    ws.on('close', (code) => resolve({ closed: code }))
  })
}

describe('attachUpgradeRouter', () => {
  it('upgrades the agent path, also after an HTTP request was served', async () => {
    const port = await start(null)
    expect(await connect(port, '/api/agents/ws')).toEqual({ msg: 'hello' })
    await get(port)
    expect(await connect(port, '/api/agents/ws')).toEqual({ msg: 'hello' })
  })

  it('is the only upgrade listener, so a Next wrapper on a separate server cannot end agent sockets', async () => {
    const nextCalls: string[] = []
    const port = await start(async (req) => {
      nextCalls.push(req.url ?? '')
    })
    expect(server!.listenerCount('upgrade')).toBe(1)
    await get(port)
    expect(await connect(port, '/api/agents/ws')).toEqual({ msg: 'hello' })
    expect(nextCalls).toEqual([])
  })

  it('ignores a query string when matching the agent path', async () => {
    const port = await start(null)
    expect(await connect(port, '/api/agents/ws?x=1')).toEqual({ msg: 'hello' })
  })

  it('forwards other paths to the Next upgrade handler', async () => {
    const seen: string[] = []
    const port = await start(async (req, socket: Duplex) => {
      seen.push(req.url ?? '')
      socket.destroy()
    })
    expect((await connect(port, '/_next/webpack-hmr')).error).toBe(true)
    expect(seen).toEqual(['/_next/webpack-hmr'])
  })

  it('destroys other paths when there is no Next upgrade handler', async () => {
    const port = await start(null)
    expect((await connect(port, '/_next/webpack-hmr')).error).toBe(true)
  })

  it('destroys the socket when the Next upgrade handler rejects', async () => {
    const port = await start(async () => {
      throw new Error('boom')
    })
    expect((await connect(port, '/other')).error).toBe(true)
  })
})
