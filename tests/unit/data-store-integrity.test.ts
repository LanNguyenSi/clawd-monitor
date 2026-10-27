/**
 * Integrity tests for src/lib/data-store.ts and its callers: reads tell a
 * missing file from an unusable one, writes replace the file atomically, and
 * no caller turns an unusable file into an empty store that a later write
 * would persist.
 *
 * DATA_DIR is a module-level const, so every test stubs the env, resets the
 * module registry and imports afresh (see tests/unit/data-store.test.ts).
 * Tests that need to fail or observe a filesystem call re-import data-store
 * with a wrapped `fs` (vi.doMock) whose hooks are the `fsHooks` object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'
import bcrypt from 'bcryptjs'
import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  isAuthenticated: vi.fn(() => true),
}))

vi.mock('@/lib/agent-registry', () => ({
  registry: { register: vi.fn(), update: vi.fn(), disconnect: vi.fn() },
}))

type DataStore = typeof import('@/lib/data-store')

let tmpDir: string
let mod: DataStore

async function loadStore(): Promise<DataStore> {
  vi.resetModules()
  return import('@/lib/data-store')
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-dsi-'))
  vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
  vi.stubEnv('ADMIN_PASSWORD_HASH', '')
  vi.stubEnv('ADMIN_PASSWORD', '')
  mod = await loadStore()
})

afterEach(() => {
  vi.doUnmock('fs')
  vi.doUnmock('crypto')
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const file = (name: string) => path.join(tmpDir, name)
const dirEntries = () => fs.readdirSync(tmpDir).sort()
const modeOf = (p: string) => fs.statSync(p).mode & 0o777
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

// ── fs wrapper with hooks ─────────────────────────────────────────────────────

interface FsHooks {
  calls: string[]
  renameTargets: Array<[string, string]>
  rename?: (from: string, to: string) => void
  unlink?: (p: string) => void
}

async function loadStoreWithFsHooks(): Promise<{ store: DataStore; hooks: FsHooks }> {
  const hooks: FsHooks = { calls: [], renameTargets: [] }
  vi.doMock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>()
    const wrapped = {
      ...actual,
      openSync: ((...a: Parameters<typeof actual.openSync>) => {
        // only the temp file counts, not the directory fsync
        if (String(a[0]).endsWith('.tmp')) hooks.calls.push('open-temp')
        return actual.openSync(...a)
      }) as typeof actual.openSync,
      writeFileSync: ((...a: Parameters<typeof actual.writeFileSync>) => {
        if (typeof a[0] === 'number') hooks.calls.push('write')
        return actual.writeFileSync(...a)
      }) as typeof actual.writeFileSync,
      fsyncSync: ((fd: number) => {
        hooks.calls.push('fsync')
        return actual.fsyncSync(fd)
      }) as typeof actual.fsyncSync,
      renameSync: ((from: string, to: string) => {
        hooks.calls.push('rename')
        hooks.renameTargets.push([String(from), String(to)])
        if (hooks.rename) return hooks.rename(String(from), String(to))
        return actual.renameSync(from, to)
      }) as typeof actual.renameSync,
      unlinkSync: ((p: string) => {
        hooks.calls.push('unlink')
        if (hooks.unlink) return hooks.unlink(String(p))
        return actual.unlinkSync(p)
      }) as typeof actual.unlinkSync,
    }
    return { ...wrapped, default: wrapped }
  })
  vi.resetModules()
  return { store: await import('@/lib/data-store'), hooks }
}

/**
 * Re-imports data-store with `crypto.randomBytes` scripted: the scripted
 * buffers are handed out first (a repeating one `times` times), then real
 * random bytes. `calls` counts every randomBytes call the store made.
 */
async function loadStoreWithRandom(script: Array<{ hex: string; times: number }>): Promise<{ store: DataStore; calls: () => number }> {
  let calls = 0
  const queue = script.flatMap(({ hex, times }) => Array.from({ length: times }, () => hex))
  vi.doMock('crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('crypto')>()
    const randomBytes = ((size: number) => {
      calls++
      const next = queue.shift()
      return next === undefined ? actual.randomBytes(size) : Buffer.from(next, 'hex')
    }) as typeof actual.randomBytes
    return { ...actual, randomBytes, default: { ...actual, randomBytes } }
  })
  vi.resetModules()
  return { store: await import('@/lib/data-store'), calls: () => calls }
}

// ── readDataFile: input matrix ────────────────────────────────────────────────

describe('readDataFile – missing, empty, invalid, valid and unreadable files', () => {
  it('missing file (ENOENT, first start): returns the default', () => {
    expect(mod.readDataFile('absent.json', 'DEFAULT')).toBe('DEFAULT')
    expect(mod.readTokens()).toEqual([])
    expect(mod.readPasswordConfig()).toEqual({})
    expect(dirEntries()).toEqual([])
  })

  it('empty file: throws DataFileError (a truncated write looks like this), file untouched', () => {
    fs.writeFileSync(file('empty.json'), '')
    expect(() => mod.readDataFile('empty.json', 'DEFAULT')).toThrow(mod.DataFileError)
    expect(() => mod.readDataFile('empty.json', 'DEFAULT')).toThrow(/empty\.json/)
    expect(fs.readFileSync(file('empty.json'), 'utf-8')).toBe('')
  })

  it('invalid JSON: throws DataFileError naming the file, keeping the parse error as cause, file untouched', () => {
    fs.writeFileSync(file('bad.json'), '[{"id":"a"')
    let thrown: unknown
    try { mod.readDataFile('bad.json', []) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(mod.DataFileError)
    expect((thrown as Error).message).toContain('bad.json')
    expect((thrown as Error).message).toContain('not valid JSON')
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError)
    expect(fs.readFileSync(file('bad.json'), 'utf-8')).toBe('[{"id":"a"')
  })

  it('valid JSON: returns the parsed value, also a falsy one', () => {
    fs.writeFileSync(file('ok.json'), '{"a":1}')
    fs.writeFileSync(file('zero.json'), '0')
    expect(mod.readDataFile('ok.json', null)).toEqual({ a: 1 })
    expect(mod.readDataFile('zero.json', 99)).toBe(0)
  })

  it('a directory in place of the file (EISDIR): throws DataFileError carrying the code', () => {
    fs.mkdirSync(file('dir.json'))
    let thrown: unknown
    try { mod.readDataFile('dir.json', 'DEFAULT') } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(mod.DataFileError)
    expect((thrown as Error).message).toContain('EISDIR')
  })

  it.skipIf(isRoot)('an unreadable file (EACCES): throws DataFileError carrying the code, not the default', () => {
    fs.writeFileSync(file('locked.json'), '{"a":1}')
    fs.chmodSync(file('locked.json'), 0o000)
    let thrown: unknown
    try { mod.readDataFile('locked.json', 'DEFAULT') } catch (e) { thrown = e }
    fs.chmodSync(file('locked.json'), 0o600)
    expect(thrown).toBeInstanceOf(mod.DataFileError)
    expect((thrown as Error).message).toContain('EACCES')
  })

  it('tokens.json of the wrong JSON shape throws (null, object, string)', () => {
    for (const body of ['null', '{}', '"x"']) {
      fs.writeFileSync(file('tokens.json'), body)
      expect(() => mod.readTokens(), body).toThrow(/tokens\.json.*not a JSON array/)
    }
  })

  it('password.json of the wrong JSON shape throws (null, array, string)', () => {
    for (const body of ['null', '[]', '"x"']) {
      fs.writeFileSync(file('password.json'), body)
      expect(() => mod.readPasswordConfig(), body).toThrow(/password\.json.*not a JSON object/)
    }
  })

  const VALID_TOKEN = { id: 't1', name: 'n', tokenHash: 'h', createdAt: 'c' }

  it('tokens.json with an entry of the wrong shape throws, whatever else is in the list', () => {
    const cases: Array<[string, unknown[]]> = [
      ['null entry first', [null, VALID_TOKEN]],
      ['null entry last', [VALID_TOKEN, null]],
      ['number entry', [VALID_TOKEN, 1]],
      ['string entry', ['x']],
      ['array entry', [[]]],
      ['id missing', [{ ...VALID_TOKEN, id: undefined }]],
      ['id not a string', [{ ...VALID_TOKEN, id: 5 }]],
      ['tokenHash missing', [{ ...VALID_TOKEN, tokenHash: undefined }]],
      ['tokenHash not a string', [{ ...VALID_TOKEN, tokenHash: 5 }]],
      ['tokenHash null', [{ ...VALID_TOKEN, tokenHash: null }]],
      ['name missing', [{ ...VALID_TOKEN, name: undefined }]],
      ['createdAt not a string', [{ ...VALID_TOKEN, createdAt: 1 }]],
      ['lastUsedAt not a string', [{ ...VALID_TOKEN, lastUsedAt: 1 }]],
    ]
    for (const [label, body] of cases) {
      fs.writeFileSync(file('tokens.json'), JSON.stringify(body))
      expect(() => mod.readTokens(), label).toThrow(mod.DataFileError)
      expect(() => mod.readTokens(), label).toThrow(/tokens\.json.*entry 0|tokens\.json.*entry 1/)
    }
  })

  it('tokens.json entries of the right shape are returned, with or without lastUsedAt', () => {
    const list = [VALID_TOKEN, { ...VALID_TOKEN, id: 't2', lastUsedAt: '2026-10-27T00:00:00.000Z' }]
    fs.writeFileSync(file('tokens.json'), JSON.stringify(list))
    expect(mod.readTokens()).toEqual(list)
  })

  it('password.json hash must be absent or a non-empty string: empty, number, null, boolean throw', () => {
    for (const body of ['{"hash":""}', '{"hash":5}', '{"hash":null}', '{"hash":false}', '{"hash":{}}']) {
      fs.writeFileSync(file('password.json'), body)
      expect(() => mod.readPasswordConfig(), body).toThrow(/password\.json.*hash is not a non-empty string/)
    }
    for (const body of ['{}', '{"hash":"h"}']) {
      fs.writeFileSync(file('password.json'), body)
      expect(() => mod.readPasswordConfig(), body).not.toThrow()
    }
  })

  it('valid tokens.json and password.json of the right shape are returned', () => {
    fs.writeFileSync(file('tokens.json'), '[]')
    fs.writeFileSync(file('password.json'), '{"hash":"h"}')
    expect(mod.readTokens()).toEqual([])
    expect(mod.readPasswordConfig()).toEqual({ hash: 'h' })
  })
})

// ── writeDataFile: atomic replace ─────────────────────────────────────────────

describe('writeDataFile – atomic replace', () => {
  it('writes complete JSON, leaves no temp file and creates mode 0600', () => {
    mod.writeDataFile('w.json', { a: [1, 2] })
    expect(JSON.parse(fs.readFileSync(file('w.json'), 'utf-8'))).toEqual({ a: [1, 2] })
    expect(dirEntries()).toEqual(['w.json'])
    const mode = modeOf(file('w.json'))
    // WSL DrvFs does not enforce unix modes; accept any mode there
    if (mode !== 0o666 && mode !== 0o777) expect(mode).toBe(0o600)
  })

  it('replaces an existing file with looser permissions by a 0600 file', () => {
    fs.writeFileSync(file('w.json'), '{"old":true}')
    fs.chmodSync(file('w.json'), 0o644)
    // WSL DrvFs does not enforce unix modes; there the mode assertion is skipped
    const enforced = modeOf(file('w.json')) === 0o644
    mod.writeDataFile('w.json', { fresh: true })
    expect(JSON.parse(fs.readFileSync(file('w.json'), 'utf-8'))).toEqual({ fresh: true })
    if (enforced) expect(modeOf(file('w.json'))).toBe(0o600)
  })

  it('goes through a temp file in the same directory, writes, fsyncs, then renames onto the target', async () => {
    const { store, hooks } = await loadStoreWithFsHooks()
    store.writeDataFile('w.json', { a: 1 })
    expect(hooks.calls.filter((c) => c !== 'unlink')).toEqual(['open-temp', 'write', 'fsync', 'rename', 'fsync'])
    const [from, to] = hooks.renameTargets[0]
    expect(path.dirname(from)).toBe(tmpDir)
    expect(from).not.toBe(to)
    expect(to).toBe(file('w.json'))
  })

  it('uses a different temp name for every write', async () => {
    const { store, hooks } = await loadStoreWithFsHooks()
    store.writeDataFile('w.json', 1)
    store.writeDataFile('w.json', 2)
    expect(hooks.renameTargets[0][0]).not.toBe(hooks.renameTargets[1][0])
  })

  it('a failing rename leaves the original intact, removes the temp file and rethrows', async () => {
    fs.writeFileSync(file('w.json'), '{"orig":true}')
    const { store, hooks } = await loadStoreWithFsHooks()
    hooks.rename = () => { throw Object.assign(new Error('EXDEV: boom'), { code: 'EXDEV' }) }
    expect(() => store.writeDataFile('w.json', { fresh: true })).toThrow('EXDEV')
    expect(fs.readFileSync(file('w.json'), 'utf-8')).toBe('{"orig":true}')
    expect(dirEntries()).toEqual(['w.json'])
  })

  it('a failing write of the temp file (target is a directory name collision) leaves no temp file', async () => {
    // the rename onto a directory fails after the temp file was written
    fs.mkdirSync(file('w.json'))
    expect(() => mod.writeDataFile('w.json', { fresh: true })).toThrow()
    expect(dirEntries()).toEqual(['w.json'])
    expect(fs.statSync(file('w.json')).isDirectory()).toBe(true)
  })

  it('simulated crash between write and rename: original intact and readable, temp left, next write still works', async () => {
    fs.writeFileSync(file('w.json'), '{"orig":true}')
    const { store, hooks } = await loadStoreWithFsHooks()
    // the process dies at the rename: nothing after it (cleanup) runs
    hooks.rename = () => { throw new Error('process killed') }
    hooks.unlink = () => { throw new Error('process killed') }
    expect(() => store.writeDataFile('w.json', { fresh: true })).toThrow('process killed')

    expect(store.readDataFile('w.json', null)).toEqual({ orig: true })
    const leftovers = dirEntries().filter((n) => n.endsWith('.tmp'))
    expect(leftovers).toHaveLength(1)
    // the temp file already holds the complete new content (it was fsynced)
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, leftovers[0]), 'utf-8'))).toEqual({ fresh: true })

    // a restarted process (fresh module instance, same pid as before as in a
    // container) writes again without tripping over the leftover
    vi.doUnmock('fs')
    vi.spyOn(process, 'pid', 'get').mockReturnValue(1)
    const restarted = await loadStore()
    restarted.writeDataFile('w.json', { next: true })
    expect(restarted.readDataFile('w.json', null)).toEqual({ next: true })
    expect(dirEntries().filter((n) => n.endsWith('.tmp'))).toEqual(leftovers)
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, leftovers[0]), 'utf-8'))).toEqual({ fresh: true })
  })

  it('restart in a container (pid 1, fresh module): a leftover named like the old pid.counter scheme neither blocks the first write nor is deleted', async () => {
    vi.spyOn(process, 'pid', 'get').mockReturnValue(1)
    fs.writeFileSync(file('w.json'), '{"orig":true}')
    fs.writeFileSync(file('.w.json.1.0.tmp'), 'LEFTOVER')
    const restarted = await loadStore()
    restarted.writeDataFile('w.json', { fresh: true })
    expect(restarted.readDataFile('w.json', null)).toEqual({ fresh: true })
    expect(fs.readFileSync(file('.w.json.1.0.tmp'), 'utf-8')).toBe('LEFTOVER')
    expect(dirEntries()).toEqual(['.w.json.1.0.tmp', 'w.json'])
  })

  it('a temp name that already exists is skipped with a new random name; the file in the way is not written to or deleted', async () => {
    fs.writeFileSync(file('w.json'), '{"orig":true}')
    const collide = '11'.repeat(8)
    fs.writeFileSync(file(`.w.json.${collide}.tmp`), 'LEFTOVER')
    const { store, calls } = await loadStoreWithRandom([{ hex: collide, times: 1 }])
    store.writeDataFile('w.json', { fresh: true })
    expect(calls()).toBe(2)
    expect(store.readDataFile('w.json', null)).toEqual({ fresh: true })
    expect(fs.readFileSync(file(`.w.json.${collide}.tmp`), 'utf-8')).toBe('LEFTOVER')
    expect(dirEntries()).toEqual([`.w.json.${collide}.tmp`, 'w.json'])
  })

  it('when every attempt hits an existing name the write fails with EEXIST after a bounded number of tries; the original and the file in the way stay', async () => {
    fs.writeFileSync(file('w.json'), '{"orig":true}')
    const collide = '22'.repeat(8)
    fs.writeFileSync(file(`.w.json.${collide}.tmp`), 'LEFTOVER')
    // 20 identical names, then real ones: an unbounded retry would succeed instead of throwing
    const { store, calls } = await loadStoreWithRandom([{ hex: collide, times: 20 }])
    expect(() => store.writeDataFile('w.json', { fresh: true })).toThrow(/EEXIST/)
    expect(calls()).toBe(5)
    expect(fs.readFileSync(file('w.json'), 'utf-8')).toBe('{"orig":true}')
    expect(fs.readFileSync(file(`.w.json.${collide}.tmp`), 'utf-8')).toBe('LEFTOVER')
    expect(dirEntries()).toEqual([`.w.json.${collide}.tmp`, 'w.json'])
  })

  it('a failed open that is not EEXIST (data dir not writable) is thrown at once, without a retry', async () => {
    const { store, calls } = await loadStoreWithRandom([])
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.writeFileSync(tmpDir, 'a file where the data dir should be')
    expect(() => store.writeDataFile('w.json', { a: 1 })).toThrow()
    expect(calls()).toBe(1)
  })

  it('writes of one process in a row never interleave: each result is the last complete document', () => {
    for (let i = 0; i < 50; i++) {
      mod.writeDataFile('w.json', { i, pad: 'x'.repeat(i * 100) })
      expect(JSON.parse(fs.readFileSync(file('w.json'), 'utf-8')).i).toBe(i)
    }
    expect(dirEntries()).toEqual(['w.json'])
  })
})

// ── callers: an unusable file is never turned into an empty store ─────────────

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
}

describe('token routes with an unusable tokens.json', () => {
  const CORRUPT = '[{"id":"t1","name":"vps","tokenHash":"$2b$10$abc'

  beforeEach(() => {
    fs.writeFileSync(file('tokens.json'), CORRUPT)
  })

  it('every route answers 500 with a logged error naming the file, and none rewrites the file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const list = await import('@/app/api/settings/tokens/route')
    const one = await import('@/app/api/settings/tokens/[id]/route')
    const ctx = { params: Promise.resolve({ id: 't1' }) }

    const responses = [
      await list.GET(req('/api/settings/tokens', 'GET')),
      await list.POST(req('/api/settings/tokens', 'POST', { name: 'new' })),
      await one.PATCH(req('/api/settings/tokens/t1', 'PATCH', { name: 'renamed' }), ctx),
      await one.DELETE(req('/api/settings/tokens/t1', 'DELETE'), ctx),
    ]
    for (const res of responses) {
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('Token store unavailable')
    }
    expect(error).toHaveBeenCalledTimes(4)
    for (const call of error.mock.calls) expect(String(call[0])).toContain('tokens.json')
    expect(fs.readFileSync(file('tokens.json'), 'utf-8')).toBe(CORRUPT)
    expect(dirEntries()).toEqual(['tokens.json'])
  })

  it('GET answers 500 for a list holding a non-object or incomplete entry, file untouched', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const list = await import('@/app/api/settings/tokens/route')
    const valid = { id: 't1', name: 'vps', tokenHash: 'h', createdAt: 'c' }
    for (const body of [JSON.stringify([null, valid]), JSON.stringify([valid, { id: 't2' }]), JSON.stringify([{ ...valid, tokenHash: 5 }])]) {
      fs.writeFileSync(file('tokens.json'), body)
      const res = await list.GET(req('/api/settings/tokens', 'GET'))
      expect(res.status, body).toBe(500)
      expect(fs.readFileSync(file('tokens.json'), 'utf-8')).toBe(body)
    }
    expect(error).toHaveBeenCalledTimes(3)
    expect(String(error.mock.calls[0][0])).toContain('entry 0')
  })

  it('once the file is repaired the same routes work again and keep the tokens', async () => {
    const list = await import('@/app/api/settings/tokens/route')
    fs.writeFileSync(file('tokens.json'), JSON.stringify([{ id: 't1', name: 'vps', tokenHash: 'h', createdAt: 'c' }]))
    const res = await list.POST(req('/api/settings/tokens', 'POST', { name: 'new' }))
    expect(res.status).toBe(201)
    expect(JSON.parse(fs.readFileSync(file('tokens.json'), 'utf-8')).map((t: { id: string }) => t.id)).toContain('t1')
  })

  it('an absent tokens.json is an empty list, not an error', async () => {
    fs.rmSync(file('tokens.json'))
    const list = await import('@/app/api/settings/tokens/route')
    const res = await list.GET(req('/api/settings/tokens', 'GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).tokens).toEqual([])
  })
})

describe('password routes with an unusable password.json', () => {
  const CORRUPT = '{"hash":"$2b$12$tru'

  beforeEach(() => {
    fs.writeFileSync(file('password.json'), CORRUPT)
    vi.stubEnv('ADMIN_PASSWORD', 'env-password')
  })

  it('login does not fall back to the env password: 500, logged, no session cookie', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req('/api/auth', 'POST', { password: 'env-password' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Password store unavailable')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(String(error.mock.calls[0][0])).toContain('password.json')
    expect(fs.readFileSync(file('password.json'), 'utf-8')).toBe(CORRUPT)
  })

  it('change-password answers 500 and does not overwrite the file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/auth/change-password/route')
    const res = await POST(req('/api/auth/change-password', 'POST', {
      currentPassword: 'env-password', newPassword: 'new-password-1', confirmPassword: 'new-password-1',
    }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Password store unavailable')
    expect(String(error.mock.calls[0][0])).toContain('password.json')
    expect(fs.readFileSync(file('password.json'), 'utf-8')).toBe(CORRUPT)
  })

  it('a password.json whose hash is empty or not a string does not fall back to the env password nor reach bcrypt', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/auth/route')
    for (const body of ['{"hash":""}', '{"hash":5}']) {
      fs.writeFileSync(file('password.json'), body)
      const res = await POST(req('/api/auth', 'POST', { password: 'env-password' }))
      expect(res.status, body).toBe(500)
      expect(res.headers.get('set-cookie'), body).toBeNull()
      expect(fs.readFileSync(file('password.json'), 'utf-8')).toBe(body)
    }
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('an absent password.json still lets the env password log in (precedence unchanged: persisted > env)', async () => {
    fs.rmSync(file('password.json'))
    const { POST } = await import('@/app/api/auth/route')
    expect((await POST(req('/api/auth', 'POST', { password: 'env-password' }))).status).toBe(200)
    fs.writeFileSync(file('password.json'), JSON.stringify({ hash: await bcrypt.hash('ui-password', 4) }))
    expect((await POST(req('/api/auth', 'POST', { password: 'env-password' }))).status).toBe(401)
    expect((await POST(req('/api/auth', 'POST', { password: 'ui-password' }))).status).toBe(200)
  })
})

// ── ws handshake against the real store ───────────────────────────────────────

describe('agent handshake with an unusable tokens.json (real store)', () => {
  class MockWs extends EventEmitter {
    send = vi.fn()
    close = vi.fn()
  }

  it('rejects with 1008, logs the reason where an operator sees it, and leaves the file as it is', async () => {
    vi.stubEnv('AGENT_TOKENS', '')
    const CORRUPT = '[{"id":"t1","tokenHash":'
    fs.writeFileSync(file('tokens.json'), CORRUPT)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { handleAgentConnection } = await import('@/lib/agent-ws-handler')
    const ws = new MockWs()
    handleAgentConnection(ws as unknown as WebSocket, {} as IncomingMessage)
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'auth', token: 'secret-agent-token-xyz', agentId: 'a1', name: 'A', version: '1',
    })))
    await vi.waitFor(() => expect(ws.close).toHaveBeenCalled(), { timeout: 5000 })

    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toEqual({ type: 'auth_error', message: 'Invalid token' })
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('Could not read tokens')
    expect(logged).toContain('tokens.json')
    expect(logged).toContain('not valid JSON')
    expect(logged).not.toContain('secret-agent-token-xyz')
    expect(fs.readFileSync(file('tokens.json'), 'utf-8')).toBe(CORRUPT)
  })

  it('a list holding a null entry rejects with 1008 and logs, instead of throwing out of the handler with the socket open', async () => {
    vi.stubEnv('AGENT_TOKENS', '')
    const hash = await bcrypt.hash('good-token', 4)
    const BODY = JSON.stringify([null, { id: 't1', name: 'n', tokenHash: hash, createdAt: 'c' }])
    fs.writeFileSync(file('tokens.json'), BODY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { handleAgentConnection } = await import('@/lib/agent-ws-handler')
    const ws = new MockWs()
    handleAgentConnection(ws as unknown as WebSocket, {} as IncomingMessage)
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'auth', token: 'good-token', agentId: 'a1', name: 'A', version: '1',
    })))
    await vi.waitFor(() => expect(ws.close).toHaveBeenCalled(), { timeout: 5000 })
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid token')
    expect(String(warn.mock.calls[0][0])).toContain('entry 0')
    expect(fs.readFileSync(file('tokens.json'), 'utf-8')).toBe(BODY)
  })

  it('a successful handshake stamps lastUsedAt through the atomic write and leaves no temp file', async () => {
    vi.stubEnv('AGENT_TOKENS', '')
    const hash = await bcrypt.hash('good-token', 4)
    fs.writeFileSync(file('tokens.json'), JSON.stringify([{ id: 't1', name: 'n', tokenHash: hash, createdAt: 'c' }]))
    const { handleAgentConnection } = await import('@/lib/agent-ws-handler')
    const ws = new MockWs()
    handleAgentConnection(ws as unknown as WebSocket, {} as IncomingMessage)
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'auth', token: 'good-token', agentId: 'a1', name: 'A', version: '1',
    })))
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled(), { timeout: 5000 })
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('auth_ok')
    expect(JSON.parse(fs.readFileSync(file('tokens.json'), 'utf-8'))[0].lastUsedAt).toEqual(expect.any(String))
    expect(dirEntries()).toEqual(['tokens.json'])
  })
})
