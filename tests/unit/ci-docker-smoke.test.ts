import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { spawnSync } from 'child_process'

// Pins the CI job that builds the production image and then starts it: the
// image must answer /api/health, not just print its tool versions. The step is
// the only place a broken runner stage (a file or module missing from the
// image) is found before the server deploy builds it.

const ROOT = resolve(__dirname, '../..')
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (s: string) => unknown }

interface Step {
  name?: string
  run?: string
}
interface Workflow {
  jobs: Record<string, { 'timeout-minutes'?: number; env?: Record<string, string>; steps: Step[] }>
}

const workflow = yaml.load(readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')) as Workflow
const job = workflow.jobs['docker-image']
const start = job.steps.find((s) => s.name === 'Image starts and answers /api/health')
const script = start?.run ?? ''

describe('ci docker-image job', () => {
  it('has a start step after the build and the runner smoke step', () => {
    const names = job.steps.map((s) => s.name)
    expect(names.indexOf('Image starts and answers /api/health')).toBeGreaterThan(
      names.indexOf('Smoke test runner stage'),
    )
    expect(names.indexOf('Smoke test runner stage')).toBeGreaterThan(names.indexOf('Build image'))
  })

  it('is bounded by a job timeout', () => {
    expect(job['timeout-minutes']).toBeGreaterThan(0)
    expect(job['timeout-minutes']).toBeLessThanOrEqual(30)
  })

  it('starts the image detached, the way the compose files run it', () => {
    expect(script).toMatch(/docker run -d\b/)
    expect(script).toContain('NODE_ENV=production')
    expect(script).toContain('CLAWD_MONITOR_DATA_DIR=/data')
    expect(script).toContain('PORT=3000')
    expect(script).toContain('HOSTNAME=0.0.0.0')
    expect(script).toContain('--memory 512m')
    expect(script).toMatch(/-v "\$vol":\/data/)
  })

  it('publishes on loopback with a random host port and never mounts the docker socket', () => {
    expect(script).toContain('-p 127.0.0.1::3000')
    expect(script).not.toContain('docker.sock')
  })

  it('generates the secrets the production start-up check requires, none hard-coded', () => {
    expect(script).toMatch(/-e JWT_SECRET="\$\(openssl rand -hex 32\)"/)
    expect(script).toMatch(/-e ADMIN_PASSWORD="\$\(openssl rand -hex 16\)"/)
  })

  it('polls /api/health on loopback until a deadline, only while the container runs', () => {
    expect(script).toMatch(/curl [^\n]*http:\/\/127\.0\.0\.1:\$port\/api\/health/)
    expect(script).toMatch(/deadline=\$\(\(SECONDS \+ \d+\)\)/)
    expect(script).toMatch(/while \[ "\$SECONDS" -lt "\$deadline" \]/)
    expect(script).toContain("docker inspect -f '{{.State.Running}}' \"$cid\"")
  })

  it('fails on a status other than 200 or a body whose top-level status is not ok, and prints the logs', () => {
    expect(script).toMatch(/\[ "\$code" != 200 \]/)
    expect(script).toContain(`jq -e '.status == "ok"' "$body"`)
    expect(script).toContain('docker logs "$cid"')
    expect(script).toMatch(/exit 1/)
  })

  it('always removes the container and the volume through an exit trap', () => {
    expect(script).toContain('trap cleanup EXIT')
    expect(script).toMatch(/docker rm -f "\$cid"/)
    expect(script).toMatch(/docker volume rm -f "\$vol"/)
    // The trap is armed before the first docker call that creates anything.
    expect(script.indexOf('trap cleanup EXIT')).toBeLessThan(script.indexOf('docker volume create'))
    expect(script.indexOf('docker volume create')).toBeLessThan(script.indexOf('docker run -d'))
  })
})

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  it('keeps tsx (the dev server runner) out of the production dependencies', () => {
    expect(pkg.dependencies).not.toHaveProperty('tsx')
    expect(pkg.devDependencies).toHaveProperty('tsx')
  })
})

// Executes the step the way Actions does (bash -e, no shell key) with stub
// docker, curl and openssl executables first on PATH. Each stub logs its argv
// and answers from the scenario variables.
describe('ci docker-image start step, executed against stubs', () => {
  interface Scenario {
    running?: 'true' | 'false'
    port?: string
    code?: string
    body?: string
    script?: string
  }
  interface Result {
    status: number | null
    timedOut: boolean
    seconds: number
    log: string[]
    curlCalls: number
    stderr: string
    stdout: string
  }

  const dirs: string[] = []
  const FAKE_CID = 'cid0123456789'

  function run(sc: Scenario): Result {
    const dir = mkdtempSync(join(tmpdir(), 'ci-smoke-'))
    dirs.push(dir)
    const bin = join(dir, 'bin')
    const log = join(dir, 'calls.log')
    const mk = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    spawnSync('mkdir', ['-p', bin])
    writeFileSync(log, '')
    mk(
      'docker',
      `echo "docker $*" >> "$STUB_LOG"
case "$1" in
  run) echo "${FAKE_CID}" ;;
  port) echo "$STUB_PORT" ;;
  inspect) echo "$STUB_RUNNING" ;;
  logs) echo "container logs" ;;
esac
exit 0`,
    )
    mk(
      'curl',
      `echo "curl $*" >> "$STUB_LOG"
out=""
while [ $# -gt 0 ]; do if [ "$1" = -o ]; then out="$2"; fi; shift; done
printf '%s' "$STUB_BODY" > "$out"
printf '%s' "$STUB_CODE"
exit 0`,
    )
    mk('openssl', 'echo deadbeef')
    writeFileSync(join(dir, 'step.sh'), sc.script ?? script)
    const t0 = Date.now()
    const r = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
      timeout: 30_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      env: {
        ...({} as NodeJS.ProcessEnv),
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        TMPDIR: dir,
        IMAGE: 'clawd-monitor:ci',
        STUB_LOG: log,
        STUB_RUNNING: sc.running ?? 'true',
        STUB_PORT: sc.port ?? '127.0.0.1:49153',
        STUB_CODE: sc.code ?? '200',
        STUB_BODY: sc.body ?? '{"status":"ok"}',
      },
    })
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean)
    return {
      status: r.status,
      timedOut: r.error !== undefined,
      seconds: (Date.now() - t0) / 1000,
      log: lines,
      curlCalls: lines.filter((l) => l.startsWith('curl ')).length,
      stderr: r.stderr,
      stdout: r.stdout,
    }
  }

  // The volume the step created must be the one it removes, and the container
  // the run printed must be the one it removes.
  function expectCleanup(r: Result) {
    const created = r.log.find((l) => l.startsWith('docker volume create '))
    expect(created).toBeDefined()
    const vol = created!.replace('docker volume create ', '')
    expect(vol).toMatch(/^clawd-monitor-ci-data-\d+$/)
    expect(r.log).toContain(`docker rm -f ${FAKE_CID}`)
    expect(r.log).toContain(`docker volume rm -f ${vol}`)
  }

  const secondDeadline = (n: number) => {
    const shortened = script.replace(/SECONDS \+ 90\)/, `SECONDS + ${n})`)
    expect(shortened).not.toBe(script)
    return shortened
  }

  afterAll(() => {
    for (const d of dirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  })

  it('passes when the server runs and answers 200 with status ok', () => {
    const r = run({})
    expect(r.timedOut).toBe(false)
    expect(r.status).toBe(0)
    expect(r.curlCalls).toBe(1)
    expect(r.stdout).toContain('health smoke ok')
    expect(r.log.some((l) => l.startsWith('docker run -d'))).toBe(true)
    expect(r.log.find((l) => l.startsWith('curl '))).toContain('http://127.0.0.1:49153/api/health')
    expect(r.log.find((l) => l.startsWith('curl '))).toContain('--max-time 2')
    expectCleanup(r)
  })

  it('fails on a 500 at once, without polling on', () => {
    const r = run({ code: '500', body: '{"status":"ok"}' })
    expect(r.status).not.toBe(0)
    expect(r.curlCalls).toBe(1)
    expect(r.stderr).toContain('status 500')
    expect(r.log).toContain(`docker logs ${FAKE_CID}`)
    expectCleanup(r)
  })

  it('fails on a 200 whose status is not ok', () => {
    const r = run({ body: '{"status":"okay"}' })
    expect(r.status).not.toBe(0)
    expect(r.log).toContain(`docker logs ${FAKE_CID}`)
    expectCleanup(r)
  })

  it('fails on a 200 that only has a nested status ok', () => {
    const r = run({ body: '{"status":"degraded","db":{"status":"ok"}}' })
    expect(r.status).not.toBe(0)
    expectCleanup(r)
  })

  it('fails on a 200 with a body that is not JSON', () => {
    const r = run({ body: 'status ok' })
    expect(r.status).not.toBe(0)
    expectCleanup(r)
  })

  it('fails right away when the container is no longer running at the first failed probe', () => {
    const r = run({ code: '000', running: 'false', script: secondDeadline(20) })
    expect(r.timedOut).toBe(false)
    expect(r.status).not.toBe(0)
    expect(r.curlCalls).toBe(1)
    expect(r.seconds).toBeLessThan(10)
    expect(r.log).toContain(`docker logs ${FAKE_CID}`)
    expectCleanup(r)
  })

  it('keeps polling while the container runs, then fails at the deadline', () => {
    const r = run({ code: '000', body: '', running: 'true', script: secondDeadline(3) })
    expect(r.timedOut).toBe(false)
    expect(r.status).not.toBe(0)
    expect(r.curlCalls).toBeGreaterThanOrEqual(2)
    expect(r.curlCalls).toBeLessThanOrEqual(5)
    // bash's SECONDS is a truncated integer, so a 3 s deadline can end after just over 2 s.
    expect(r.seconds).toBeGreaterThanOrEqual(2)
    expect(r.seconds).toBeLessThan(15)
    expect(r.stderr).toContain('status 000')
    expectCleanup(r)
  })

  it('fails with the logs when the container published no port, without polling', () => {
    const r = run({ port: '' })
    expect(r.status).not.toBe(0)
    expect(r.curlCalls).toBe(0)
    expect(r.stderr).toContain('published no host port')
    expect(r.log).toContain(`docker logs ${FAKE_CID}`)
    expectCleanup(r)
  })
})
