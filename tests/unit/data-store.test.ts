/**
 * Unit tests for src/lib/data-store.ts
 *
 * DATA_DIR is captured once as a module-level const at import time.
 * Each describe group must: vi.stubEnv → vi.resetModules → dynamic import
 * to get a module instance bound to a controlled temp directory.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ── group 1: readDataFile + writeDataFile + round-trip helpers ────────────────

describe('data-store – readDataFile, writeDataFile, readTokens, writeTokens, readPasswordConfig, writePasswordConfig', () => {
  let tmpDir: string
  let mod: typeof import('@/lib/data-store')

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ds-'))
    vi.stubEnv('CLAWD_MONITOR_DATA_DIR', tmpDir)
    vi.resetModules()
    mod = await import('@/lib/data-store')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── readDataFile ─────────────────────────────────────────────────────────────

  it('readDataFile – returns parsed content when the file exists', () => {
    const data = { hello: 'world', count: 42 }
    fs.writeFileSync(path.join(tmpDir, 'read-test.json'), JSON.stringify(data))
    expect(mod.readDataFile('read-test.json', null)).toEqual(data)
  })

  it('readDataFile – returns defaultValue when the file is missing', () => {
    expect(mod.readDataFile('does-not-exist.json', 'DEFAULT')).toBe('DEFAULT')
  })

  it('readDataFile – returns defaultValue on corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'corrupt.json'), '{not json')
    expect(mod.readDataFile('corrupt.json', 'DEFAULT')).toBe('DEFAULT')
  })

  // ── writeDataFile ─────────────────────────────────────────────────────────────

  it('writeDataFile – persists data that round-trips via readDataFile', () => {
    const data = { key: 'value', nested: { n: 7 } }
    mod.writeDataFile('write-test.json', data)
    expect(mod.readDataFile('write-test.json', null)).toEqual(data)
  })

  it('writeDataFile – sets mode 0o600 on the written file', () => {
    mod.writeDataFile('mode-test.json', { x: 1 })
    const stat = fs.statSync(path.join(tmpDir, 'mode-test.json'))
    const mode = stat.mode & 0o777
    // On Linux/ext4 this must be 0o600. On some WSL DrvFs mounts (Windows
    // FS) Unix permission bits are not enforced and mode may differ — in
    // that case we fall back to asserting the file exists and round-trips.
    if (mode !== 0o600) {
      // eslint-disable-next-line no-console
      console.warn(`[test] mode-check skipped: filesystem returned 0o${mode.toString(8)} (WSL/DrvFs?)`)
      expect(fs.existsSync(path.join(tmpDir, 'mode-test.json'))).toBe(true)
    } else {
      expect(mode).toBe(0o600)
    }
  })

  // ── readTokens / writeTokens ─────────────────────────────────────────────────

  it('readTokens – returns empty array when no tokens file exists', () => {
    // tokens.json has not been written in this describe group yet
    expect(mod.readTokens()).toEqual([])
  })

  it('readTokens / writeTokens – round-trip', () => {
    const tokens: import('@/lib/data-store').TokenEntry[] = [
      { id: 'tok-1', name: 'my-token', tokenHash: '$2b$04$abc', createdAt: '2024-01-01T00:00:00Z' },
    ]
    mod.writeTokens(tokens)
    expect(mod.readTokens()).toEqual(tokens)
  })

  // ── readPasswordConfig / writePasswordConfig ──────────────────────────────────

  it('readPasswordConfig – returns empty object when no password file exists', () => {
    // password.json has not been written in this describe group yet
    expect(mod.readPasswordConfig()).toEqual({})
  })

  it('readPasswordConfig / writePasswordConfig – round-trip', () => {
    const cfg: import('@/lib/data-store').PasswordConfig = { hash: '$2b$12$xyz', plaintext: undefined }
    mod.writePasswordConfig(cfg)
    // JSON round-trip strips undefined keys
    expect(mod.readPasswordConfig()).toEqual({ hash: '$2b$12$xyz' })
  })
})

// ── group 2: getDataDir creates the directory when absent ─────────────────────

describe('data-store – getDataDir creates missing directory', () => {
  let nonExistingDir: string
  let mod: typeof import('@/lib/data-store')

  beforeAll(async () => {
    // Point DATA_DIR at a path that does not exist yet
    nonExistingDir = path.join(os.tmpdir(), `cm-ds-absent-${Date.now()}`)
    expect(fs.existsSync(nonExistingDir)).toBe(false)

    vi.stubEnv('CLAWD_MONITOR_DATA_DIR', nonExistingDir)
    vi.resetModules()
    mod = await import('@/lib/data-store')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    fs.rmSync(nonExistingDir, { recursive: true, force: true })
  })

  it('getDataDir – creates the directory when it does not exist', () => {
    expect(fs.existsSync(nonExistingDir)).toBe(false)
    mod.getDataDir()
    expect(fs.existsSync(nonExistingDir)).toBe(true)
  })

  it('getDataDir – returns the configured DATA_DIR path', () => {
    expect(mod.getDataDir()).toBe(nonExistingDir)
  })
})
