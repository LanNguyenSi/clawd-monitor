import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'child_process'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { resolve } from 'path'

// Guards the container settings of the two compose files and the Makefile
// docker targets: the healthcheck against /api/health (and that its command
// really exits 0 on a 2xx and 1 on everything else, including a hang), the
// memory limit, the log rotation, and that `make docker-up` / `make
// docker-down` can only ever address the plain local stack.

const ROOT = resolve(__dirname, '../..')
// js-yaml ships no types in this repo; a require keeps tsc quiet and returns any.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (s: string) => unknown }

interface Compose {
  services: {
    app: {
      healthcheck: {
        test: string[]
        interval: string
        timeout: string
        retries: number
        start_period: string
      }
      mem_limit: string
      logging: unknown
      restart: string
    }
  }
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.traefik.yml'] as const

function loadCompose(file: string): Compose {
  return yaml.load(readFileSync(resolve(ROOT, file), 'utf8')) as Compose
}

describe.each(COMPOSE_FILES)('%s app service', (file) => {
  const app = loadCompose(file).services.app

  it('has a healthcheck that probes /api/health through node', () => {
    const hc = app.healthcheck
    expect(hc).toBeDefined()
    expect(hc.test[0]).toBe('CMD')
    expect(hc.test.slice(1, 3)).toEqual(['node', '-e'])
    expect(hc.test[3]).toContain('/api/health')
    // The probe has to give up before docker's own timeout, and a few failures
    // must pass before the container is marked unhealthy.
    expect(hc.interval).toBe('30s')
    expect(hc.timeout).toBe('5s')
    expect(hc.retries).toBe(3)
    expect(hc.start_period).toBe('20s')
  })

  it('limits memory to 512m', () => {
    expect(app.mem_limit).toBe('512m')
  })

  it('rotates the json-file log: 10m, 3 files', () => {
    expect(app.logging).toEqual({
      driver: 'json-file',
      options: { 'max-size': '10m', 'max-file': '3' },
    })
  })

  it('keeps the restart policy next to the healthcheck', () => {
    expect(app.restart).toBe('unless-stopped')
  })
})

describe('the two compose files carry the same healthcheck command', () => {
  it('is one command in both', () => {
    const [a, b] = COMPOSE_FILES.map((f) => loadCompose(f).services.app.healthcheck.test)
    expect(a).toEqual(b)
  })
})

describe('healthcheck command behaviour', () => {
  const script: string = loadCompose('docker-compose.traefik.yml').services.app.healthcheck.test[3]
  let ok: Server
  let bad: Server
  let hang: Server
  let closed: Server
  const port = (s: Server) => (s.address() as AddressInfo).port
  let closedPort = 0

  function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
    return new Promise((res) => {
      const s = createServer(handler)
      s.listen(0, '127.0.0.1', () => res(s))
    })
  }

  beforeAll(async () => {
    ok = await listen((req, res) => {
      res.statusCode = req.url === '/api/health' ? 200 : 404
      res.end('{"status":"ok"}')
    })
    bad = await listen((_req, res) => {
      res.statusCode = 503
      res.end('down')
    })
    // Accepts the connection and never answers: a hung event loop.
    hang = await listen(() => {})
    closed = await listen(() => {})
    closedPort = port(closed)
    await new Promise<void>((r) => closed.close(() => r()))
  })

  afterAll(async () => {
    for (const s of [ok, bad, hang]) {
      s.closeAllConnections()
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  function run(p: number): Promise<{ code: number | null; ms: number }> {
    return new Promise((res) => {
      const t0 = Date.now()
      const child = spawn(process.execPath, ['-e', script], {
        env: { ...process.env, PORT: String(p) },
        stdio: 'ignore',
        // Hard bound for a probe that never gives up; SIGKILL leaves nothing behind.
        timeout: 12000,
        killSignal: 'SIGKILL',
      })
      child.on('close', (code) => res({ code, ms: Date.now() - t0 }))
    })
  }

  it('exits 0 on a 200 from /api/health', async () => {
    expect((await run(port(ok))).code).toBe(0)
  })

  it('exits 1 on a non-2xx answer', async () => {
    expect((await run(port(bad))).code).toBe(1)
  })

  it('exits 1 when nothing listens', async () => {
    expect((await run(closedPort)).code).toBe(1)
  })

  it('exits 1 when the server accepts but never answers, within the docker timeout', async () => {
    const r = await run(port(hang))
    expect(r.code).toBe(1)
    // Docker kills the check after the 5s compose timeout; the probe has to
    // end itself earlier.
    expect(r.ms).toBeLessThan(5000)
  }, 15000)
})

describe('Makefile docker targets', () => {
  const lines = readFileSync(resolve(ROOT, 'Makefile'), 'utf8').split('\n')
  const code = lines.filter((l) => !l.trim().startsWith('#'))
  const def = code.find((l) => l.startsWith('COMPOSE_LOCAL'))

  it('define the compose command once, with the plain file and a fixed project name', () => {
    expect(def).toBeDefined()
    expect(def).toMatch(/\s-f docker-compose\.yml(\s|$)/)
    expect(def).toMatch(/\s-p clawd-monitor-local(\s|$)/)
    expect(def).not.toContain('traefik')
  })

  it('does not use the directory name as project (that is what production runs under)', () => {
    expect(def).not.toMatch(/\s-p clawd-monitor(\s|$)/)
  })

  it('never calls docker compose outside that variable', () => {
    const bare = code.filter((l) => l !== def && /docker[ -]compose/.test(l))
    expect(bare).toEqual([])
  })

  it('docker-up and docker-down go through the variable', () => {
    const recipe = (target: string) => {
      const i = code.findIndex((l) => l.startsWith(`${target}:`))
      return code[i + 1]
    }
    expect(recipe('docker-up')).toBe('\t$(COMPOSE_LOCAL) up -d')
    expect(recipe('docker-down')).toBe('\t$(COMPOSE_LOCAL) down')
  })
})
