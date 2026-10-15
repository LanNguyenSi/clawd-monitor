/**
 * GitHub PR widget route (repo list from GITHUB_REPOS, CI status from
 * check-runs) and Service Health route (URL list from SERVICE_HEALTH_URLS).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn(() => true) }))

import { GET as githubGET } from '@/app/api/proxy/github/route'
import { GET as healthGET } from '@/app/api/proxy/health/route'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => { vi.stubEnv('GITHUB_TOKEN', 'ghp_test') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('GET /api/proxy/github', () => {
  it('reports a missing repository list instead of falling back to a hardcoded one', async () => {
    vi.stubEnv('GITHUB_REPOS', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const body = await (await githubGET(new NextRequest('http://localhost/api/proxy/github'))).json()
    expect(body.error).toMatch(/GITHUB_REPOS/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads repos from GITHUB_REPOS and fills ciStatus from the head commit check-runs', async () => {
    vi.stubEnv('GITHUB_REPOS', 'octo/one')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/pulls?')) {
        return json([{ id: 1, number: 7, title: 'T', html_url: 'u', state: 'open', draft: false, created_at: 'c', head: { sha: 'abc123' } }])
      }
      if (url.includes('/commits/abc123/check-runs')) {
        return json({ check_runs: [{ status: 'completed', conclusion: 'failure' }] })
      }
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const body = await (await githubGET(new NextRequest('http://localhost/api/proxy/github'))).json()
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/octo/one/pulls')
    expect(body.prs).toHaveLength(1)
    expect(body.prs[0]).toMatchObject({ repo: 'octo/one', number: 7, ciStatus: 'failure' })
  })

  it('falls back to unknown when the check-runs lookup fails', async () => {
    vi.stubEnv('GITHUB_REPOS', 'octo/one')
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/pulls?')
        ? json([{ id: 1, number: 7, title: 'T', html_url: 'u', state: 'open', draft: false, created_at: 'c', head: { sha: 'abc123' } }])
        : json({}, 403)))
    const body = await (await githubGET(new NextRequest('http://localhost/api/proxy/github'))).json()
    expect(body.prs[0].ciStatus).toBe('unknown')
  })

  it('does not re-query check-runs for a commit that already passed, but re-queries a failed one', async () => {
    vi.stubEnv('GITHUB_REPOS', 'octo/cache')
    const outcome: Record<string, string> = { green1: 'success', red1: 'failure' }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/pulls?')) {
        return json([
          { id: 1, number: 1, title: 'a', html_url: 'u', state: 'open', draft: false, created_at: 'c', head: { sha: 'green1' } },
          { id: 2, number: 2, title: 'b', html_url: 'u', state: 'open', draft: false, created_at: 'c', head: { sha: 'red1' } },
        ])
      }
      const sha = /commits\/(\w+)\/check-runs/.exec(url)?.[1] ?? ''
      return json({ check_runs: [{ status: 'completed', conclusion: outcome[sha] }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const req = () => new NextRequest('http://localhost/api/proxy/github')
    await githubGET(req())
    const second = await (await githubGET(req())).json()
    const checkRunCalls = fetchMock.mock.calls.map((c) => (c as unknown[])[0] as string).filter((u) => u.includes('/check-runs'))
    expect(checkRunCalls.filter((u) => u.includes('/green1/'))).toHaveLength(1)
    expect(checkRunCalls.filter((u) => u.includes('/red1/'))).toHaveLength(2)
    expect(second.prs.map((p: { ciStatus: string }) => p.ciStatus).sort()).toEqual(['failure', 'success'])
  })

  it('bounds the passed-commit cache by evicting the oldest entry', async () => {
    vi.stubEnv('GITHUB_REPOS', 'octo/bounded')
    const shas = Array.from({ length: 201 }, (_, i) => `sha${i}x`)
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/pulls?')
        ? json(shas.map((sha, i) => ({ id: i, number: i, title: 't', html_url: 'u', state: 'open', draft: false, created_at: 'c', head: { sha } })))
        : json({ check_runs: [{ status: 'completed', conclusion: 'success' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const req = () => new NextRequest('http://localhost/api/proxy/github')
    await githubGET(req())
    fetchMock.mockClear()
    await githubGET(req())
    const urls = fetchMock.mock.calls.map((c) => (c as unknown[])[0] as string).filter((u) => u.includes('/check-runs'))
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/commits/sha0x/')
  })
})

describe('GET /api/proxy/health', () => {
  it('checks nothing when SERVICE_HEALTH_URLS is unset', async () => {
    vi.stubEnv('SERVICE_HEALTH_URLS', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const body = await (await healthGET(new NextRequest('http://localhost/api/proxy/health'))).json()
    expect(body.services).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HEAD-checks each configured URL', async () => {
    vi.stubEnv('SERVICE_HEALTH_URLS', 'api=https://a.example.com/health,https://b.example.com')
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = await (await healthGET(new NextRequest('http://localhost/api/proxy/health'))).json()
    expect(body.services.map((s: { name: string; ok: boolean }) => [s.name, s.ok])).toEqual([['api', true], ['b.example.com', true]])
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['https://a.example.com/health', 'https://b.example.com'])
  })
})
