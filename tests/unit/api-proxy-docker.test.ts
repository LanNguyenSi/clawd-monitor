/**
 * Unit tests for src/app/api/proxy/docker/route.ts (GET).
 *
 * child_process.execSync is mocked. The `docker inspect` mock derives its
 * stdout from the actual --format string the route passes, substituting only
 * the two template fields, so a literal backslash-t stays a backslash-t
 * (docker inspect does not convert escapes; only docker ps does).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn() }))
vi.mock('child_process', () => ({ execSync: vi.fn() }))

import { execSync } from 'child_process'
import { isAuthenticated } from '@/lib/auth'
import { GET } from '@/app/api/proxy/docker/route'

const execMock = vi.mocked(execSync)
const authMock = vi.mocked(isAuthenticated)

const A = 'abc123def456'
const B = 'fff111222333'
const full = (short: string) => short + '0'.repeat(52)

function emulateInspect(cmd: string, rows: Array<[string, number]>): string {
  const tpl = /--format "([^"]*)"/.exec(cmd)?.[1] ?? ''
  return rows
    .map(([id, n]) => tpl.replace('{{.Id}}', id).replace('{{.RestartCount}}', String(n)))
    .join('\n') + '\n'
}

function req(): NextRequest {
  return new NextRequest('http://localhost/api/proxy/docker')
}

beforeEach(() => {
  execMock.mockReset()
  authMock.mockReset()
  authMock.mockReturnValue(true)
})

describe('GET /api/proxy/docker', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockReturnValue(false)
    expect((await GET(req())).status).toBe(401)
  })

  it('shows no restart count for an exited container with exit code 137 and RestartCount 0', async () => {
    execMock.mockImplementation(((cmd: string) => {
      if (cmd.startsWith('docker ps')) {
        return `${A}\tmy-app\tnginx:1\tExited (137) 2 hours ago\texited\t2 hours ago\n` +
          `${B}\tother\tredis\tUp 1 hour\trunning\t1 hour ago\n`
      }
      return emulateInspect(cmd, [[full(A), 0], [full(B), 2]])
    }) as never)
    const body = await (await GET(req())).json()
    expect(body.containers[0].restarts).toBe(0)
    expect(body.containers[0].status).toBe('Exited (137) 2 hours ago')
    expect(body.containers[1].restarts).toBe(2)
    const calls = execMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain(`${A} ${B}`)
  })

  it('keeps the other counts when one id vanished and inspect exits non-zero', async () => {
    execMock.mockImplementation(((cmd: string) => {
      if (cmd.startsWith('docker ps')) {
        return `${A}\tmy-app\tnginx\tUp 1 hour\trunning\t1 hour ago\n` +
          `${B}\tgone\tredis\tUp 1 hour\trunning\t1 hour ago\n`
      }
      throw Object.assign(new Error('No such object'), {
        status: 1,
        stdout: emulateInspect(cmd, [[full(A), 4]]),
      })
    }) as never)
    const body = await (await GET(req())).json()
    expect(body.containers[0].restarts).toBe(4)
    expect('restarts' in body.containers[1]).toBe(false)
    const opts = execMock.mock.calls[1][1] as { stdio?: unknown }
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })

  it('omits restarts when inspect yields no count', async () => {
    execMock.mockImplementation(((cmd: string) => {
      if (cmd.startsWith('docker ps')) return `${A}\tmy-app\tnginx\tUp (1)\trunning\t2 hours ago\n`
      throw new Error('inspect failed')
    }) as never)
    const body = await (await GET(req())).json()
    expect(body.containers).toHaveLength(1)
    expect('restarts' in body.containers[0]).toBe(false)
  })

  it('ignores unparsable inspect lines', async () => {
    execMock.mockImplementation(((cmd: string) => {
      if (cmd.startsWith('docker ps')) return `${A}\tmy-app\tnginx\tUp\trunning\t1 hour ago\n`
      return 'garbage\n' + `${full(A)} notanumber\n`
    }) as never)
    const body = await (await GET(req())).json()
    expect('restarts' in body.containers[0]).toBe(false)
  })

  it('reports an error payload when docker ps fails', async () => {
    execMock.mockImplementation(() => { throw new Error('docker: command not found') })
    const body = await (await GET(req())).json()
    expect(body.containers).toEqual([])
    expect(body.error).toBeDefined()
  })
})
