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
