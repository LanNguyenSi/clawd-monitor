import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

  it('fails on a status other than 200 or a body without status ok, and prints the logs', () => {
    expect(script).toMatch(/\[ "\$code" != 200 \]/)
    expect(script).toContain(`grep -q '"status":"ok"' "$body"`)
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
