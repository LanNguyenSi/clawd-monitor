/**
 * A value set only in .env.local must reach the modules that read process.env
 * at load time (agent WebSocket handler, registry, data-store) and the token
 * routes, and must not override a value already in the process environment.
 *
 * The import-order part runs in a child process (tsx), because the question is
 * what a freshly started server sees, which module state inside vitest cannot
 * show.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const repo = path.resolve(__dirname, '..', '..')
const tsx = path.join(repo, 'node_modules', '.bin', 'tsx')

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-env-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

/** Run a script in a fresh process (cwd = temp dir) and return its last stdout line. */
function runFresh(lines: string[], extraEnv: Record<string, string> = {}): string {
  const script = path.join(dir, 'probe.ts')
  fs.writeFileSync(script, lines.join('\n'))
  // @next/env skips .env.local when NODE_ENV=test (vitest's default), so pin it.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', ...extraEnv }
  delete env.CLAWD_MONITOR_DATA_DIR
  delete env.AGENT_TOKENS
  return execFileSync(tsx, [script], { cwd: dir, env, timeout: 60_000 }).toString().trim().split('\n').pop()!
}

const bootstrap = JSON.stringify(path.join(repo, 'src/lib/env-bootstrap.ts'))

describe('env bootstrap', () => {
  it('loads values from .env.local into process.env', () => {
    fs.writeFileSync(path.join(dir, '.env.local'), 'CM_TEST_ONLY_IN_FILE=from-file\n')
    const out = runFresh([`import ${bootstrap}`, 'console.log(process.env.CM_TEST_ONLY_IN_FILE)'])
    expect(out).toBe('from-file')
  })

  it('does not override a value already in the process environment', () => {
    fs.writeFileSync(path.join(dir, '.env.local'), 'CM_TEST_IN_BOTH=from-file\n')
    const out = runFresh([`import ${bootstrap}`, 'console.log(process.env.CM_TEST_IN_BOTH)'], { CM_TEST_IN_BOTH: 'from-process' })
    expect(out).toBe('from-process')
  })
})

describe('server start order', () => {
  it('server.ts imports the env bootstrap before every other import', () => {
    const src = fs.readFileSync(path.join(repo, 'server.ts'), 'utf-8')
    const imports = src.split('\n').filter((l) => /^import\b/.test(l))
    expect(imports[0]).toBe("import './src/lib/env-bootstrap.js'")
  })

  it('a CLAWD_MONITOR_DATA_DIR set only in .env.local reaches data-store and the ws handler graph', () => {
    const dataDir = path.join(dir, 'data')
    fs.writeFileSync(path.join(dir, '.env.local'), `CLAWD_MONITOR_DATA_DIR=${dataDir}\nAGENT_TOKENS=static-from-file\n`)
    // Same import order as server.ts: bootstrap first, then the handler graph.
    const out = runFresh([
      `import ${bootstrap}`,
      `import { getDataDir } from ${JSON.stringify(path.join(repo, 'src/lib/data-store.ts'))}`,
      `import { handleAgentConnection } from ${JSON.stringify(path.join(repo, 'src/lib/agent-ws-handler.ts'))}`,
      'void handleAgentConnection',
      'console.log(JSON.stringify({ dataDir: getDataDir(), tokens: process.env.AGENT_TOKENS }))',
    ])
    expect(JSON.parse(out)).toEqual({ dataDir, tokens: 'static-from-file' })
  })
})
