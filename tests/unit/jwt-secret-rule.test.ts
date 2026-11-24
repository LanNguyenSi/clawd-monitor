/**
 * The single JWT_SECRET rule shared by server.ts (production startup check)
 * and src/lib/auth.ts (getJwtSecret): in production the secret is required,
 * and its raw length must be at least JWT_SECRET_MIN_LENGTH. A value that is
 * empty or whitespace-only counts as absent; the minimum counts the raw
 * value (no trimming). The messages name the variable and the minimum and
 * never contain the secret.
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { jwtSecretProblem, JWT_SECRET_MIN_LENGTH } from '@/lib/auth'

// ── the rule, input by input ──────────────────────────────────────────────────

const SHORT = 'short-secret-value-x' // 18 chars, < 32
// Literal lengths, not derived from the constant: a mutation of the minimum
// must break the tests, not move them along with it.
const SHORT31 = 'x'.repeat(31) // exactly one below the pinned minimum of 32
const OK32 = 'y'.repeat(32) // exactly at the pinned minimum
const OK64 = 'z'.repeat(64)

describe('jwtSecretProblem: each input alone', () => {
  it('the minimum is 32', () => {
    expect(JWT_SECRET_MIN_LENGTH).toBe(32)
  })

  it('absent secret is a problem naming the variable', () => {
    const p = jwtSecretProblem(undefined)
    expect(p).toBeDefined()
    expect(p).toContain('JWT_SECRET')
  })

  it('empty secret is a problem naming the variable', () => {
    const p = jwtSecretProblem('')
    expect(p).toBeDefined()
    expect(p).toContain('JWT_SECRET')
  })

  it('whitespace-only secret counts as empty', () => {
    const p = jwtSecretProblem('   ')
    expect(p).toBeDefined()
    expect(p).toContain('JWT_SECRET')
  })

  it('31 characters is a problem naming the variable and the minimum', () => {
    const p = jwtSecretProblem(SHORT31)
    expect(p).toBeDefined()
    expect(p).toContain('JWT_SECRET')
    expect(p).toContain(String(JWT_SECRET_MIN_LENGTH))
    expect(p).toContain('31')
  })

  it('32 characters passes', () => {
    expect(jwtSecretProblem(OK32)).toBeUndefined()
  })

  it('64 characters passes', () => {
    expect(jwtSecretProblem(OK64)).toBeUndefined()
  })

  it('the minimum counts the raw length: 31 characters plus a trailing space passes', () => {
    expect(jwtSecretProblem(`${SHORT31} `)).toBeUndefined()
  })
})

describe('jwtSecretProblem: the message never contains the secret', () => {
  it('a short value does not appear in the message', () => {
    expect(jwtSecretProblem(SHORT)).not.toContain(SHORT)
    expect(jwtSecretProblem(SHORT31)).not.toContain(SHORT31)
  })

  it('a whitespace-only value does not appear in the message', () => {
    expect(jwtSecretProblem(' \t ')).not.toContain('\t')
  })
})

// ── the production startup check in server.ts ─────────────────────────────────
//
// Runs the real server.ts in a child process (tsx), the way a production
// start would: with a too-short secret it must exit 1 with a message that
// names the variable and the minimum. With a valid secret the check must let
// it through (what the child does afterwards, a missing production build or
// a listen, is not asserted).

const ROOT = resolve(__dirname, '..', '..')
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx')
const SERVER = join(ROOT, 'server.ts')

interface Run {
  code: number | null
  killed: boolean
  out: string
}

/** Start server.ts with an explicit, inherited-free environment and capture its output. */
function runServer(env: Record<string, string>, deadlineMs: number): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'cm-jwt-server-'))
  return new Promise((done) => {
    const child = spawn(TSX, [SERVER], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: dir, ...env } as unknown as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, deadlineMs)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      done({ code, killed: signal !== null, out })
    })
  })
}

const prodEnv = (jwt: Record<string, string>): Record<string, string> => ({
  NODE_ENV: 'production',
  PORT: '0',
  ADMIN_PASSWORD: 'admin-password-for-jwt-rule-test',
  ...jwt,
})

describe('server.ts production startup check', () => {
  it('exits 1 with a message naming JWT_SECRET and the minimum when the secret is too short', async () => {
    const run = await runServer(prodEnv({ JWT_SECRET: SHORT31 }), 30_000)
    expect(run.code).toBe(1)
    expect(run.out).toContain('JWT_SECRET')
    expect(run.out).toContain(String(JWT_SECRET_MIN_LENGTH))
    expect(run.out).not.toContain(SHORT31)
  }, 60_000)

  it('exits 1 when JWT_SECRET is absent', async () => {
    const run = await runServer(prodEnv({}), 30_000)
    expect(run.code).toBe(1)
    expect(run.out).toContain('JWT_SECRET')
  }, 60_000)

  it('does not reject a 64-character secret', async () => {
    // A passing check shows itself by getting past the startup check: no
    // JWT_SECRET message in the output, whether the child then fails on the
    // missing production build or is still alive (startup check passed, it
    // is serving or preparing) when the deadline kills it.
    const run = await runServer(prodEnv({ JWT_SECRET: 'w'.repeat(64) }), 30_000)
    expect(run.out).not.toContain('JWT_SECRET')
  }, 60_000)
})

describe('server.ts development startup check', () => {
  it('warns about a short JWT_SECRET without its value', async () => {
    // The warning is printed at the top of server.ts, before Next.js prepares,
    // so a short deadline is enough. What the child does afterwards (it fails
    // without a Next.js project in its scratch cwd) is not asserted.
    const run = await runServer({ NODE_ENV: 'development', PORT: '0', JWT_SECRET: SHORT31 }, 5_000)
    expect(run.out).toContain(`[startup] JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`)
    expect(run.out).toContain('accepted in development')
    expect(run.out).not.toContain(SHORT31)
  }, 30_000)
})
