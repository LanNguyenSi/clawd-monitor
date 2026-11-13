/**
 * A persisted-token handshake against the real data-store and a real data
 * directory: a missing tokens.json is "no persisted tokens" (a real auth
 * failure), while a corrupt file or a directory in its place is a store
 * failure and is refused retryably (close 1013, no auth_error), and the same
 * agent authenticates once the file is fixed.
 *
 * DATA_DIR is a module-level const, so the env is stubbed and the modules are
 * imported afresh per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'
import bcrypt from 'bcryptjs'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

vi.mock('@/lib/agent-registry', () => ({
  registry: { register: vi.fn(), update: vi.fn(), disconnect: vi.fn() },
}))

class MockWs extends EventEmitter {
  send = vi.fn()
  close = vi.fn(() => {
    queueMicrotask(() => this.emit('close'))
  })
}

const PLAINTEXT = 'real-store-persisted-token'
const AGENT_ID = 'real-store-agent'

let tmpDir: string
let tokensPath: string
let hash: string
let handle: (ws: WebSocket, req: IncomingMessage) => void
let register: ReturnType<typeof vi.fn>

async function handshake(): Promise<MockWs> {
  const ws = new MockWs()
  handle(ws as unknown as WebSocket, {} as IncomingMessage)
  ws.emit('message', Buffer.from(JSON.stringify({
    type: 'auth', token: PLAINTEXT, agentId: AGENT_ID, name: 'Real Store Agent', version: '1',
  })))
  await vi.waitFor(() => expect(ws.send.mock.calls.length + ws.close.mock.calls.length).toBeGreaterThan(0), { timeout: 5000 })
  return ws
}

function writeGoodStore() {
  fs.writeFileSync(tokensPath, JSON.stringify([
    { id: 'tok-1', name: 'persisted', tokenHash: hash, createdAt: new Date().toISOString() },
  ]))
}

beforeEach(async () => {
  hash = await bcrypt.hash(PLAINTEXT, 4)
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-ws-store-'))
  tokensPath = path.join(tmpDir, 'tokens.json')
  vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
  vi.stubEnv('AGENT_TOKENS', '')
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  ;({ handleAgentConnection: handle } = await import('@/lib/agent-ws-handler'))
  register = (await import('@/lib/agent-registry')).registry.register as unknown as ReturnType<typeof vi.fn>
  register.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('persisted-token handshake against a real tokens.json', () => {
  it('a missing tokens.json is no persisted tokens: auth_error and close 1008', async () => {
    const ws = await handshake()
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_error')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(register).not.toHaveBeenCalled()
  })

  it('a corrupt tokens.json is refused retryably: close 1013, no auth_error, nothing registered, file untouched', async () => {
    fs.writeFileSync(tokensPath, '{"truncated": ')
    const ws = await handshake()
    expect(ws.send).not.toHaveBeenCalled()
    expect(ws.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(register).not.toHaveBeenCalled()
    expect(fs.readFileSync(tokensPath, 'utf-8')).toBe('{"truncated": ')
  })

  it('a tokens.json of the wrong shape is refused retryably too', async () => {
    fs.writeFileSync(tokensPath, '{}')
    const ws = await handshake()
    expect(ws.send).not.toHaveBeenCalled()
    expect(ws.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(register).not.toHaveBeenCalled()
  })

  it('a directory in place of tokens.json is refused retryably', async () => {
    fs.mkdirSync(tokensPath)
    const ws = await handshake()
    expect(ws.send).not.toHaveBeenCalled()
    expect(ws.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(register).not.toHaveBeenCalled()
  })

  it('the same agent authenticates once a corrupt file is fixed', async () => {
    fs.writeFileSync(tokensPath, 'not json')
    const refused = await handshake()
    expect(refused.close).toHaveBeenCalledWith(1013, 'Server busy')
    expect(refused.send).not.toHaveBeenCalled()

    writeGoodStore()
    const ok = await handshake()
    expect(JSON.parse(ok.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    expect(ok.close).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledOnce()
  })
})
