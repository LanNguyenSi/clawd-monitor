import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { summarizeCheckRuns, type CheckRun } from '@/lib/github-ci'

export const dynamic = 'force-dynamic'

interface GitHubPR {
  id: number
  number: number
  title: string
  repo: string
  url: string
  state: string
  draft: boolean
  createdAt: string
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
}

const GH_HEADERS = (token: string) => ({ Authorization: `token ${token}`, 'User-Agent': 'clawd-monitor' })

// A commit whose checks all passed does not change status, so repeated polls
// reuse it. Failures are not cached (a re-run can flip them) and the map is
// bounded, oldest entry first out.
const CI_CACHE_MAX = 200
const passedCi = new Map<string, GitHubPR['ciStatus']>()

async function fetchCiStatus(owner: string, repo: string, sha: string, token: string): Promise<GitHubPR['ciStatus']> {
  const key = `${owner}/${repo}@${sha}`
  const cached = passedCi.get(key)
  if (cached) return cached
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`, {
      headers: GH_HEADERS(token),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return 'unknown'
    const body = await res.json() as { check_runs?: CheckRun[] }
    const status = summarizeCheckRuns(body.check_runs ?? [])
    if (status === 'success') {
      if (passedCi.size >= CI_CACHE_MAX) passedCi.delete(passedCi.keys().next().value as string)
      passedCi.set(key, status)
    }
    return status
  } catch {
    return 'unknown'
  }
}

async function fetchPRsForRepo(owner: string, repo: string, token: string): Promise<GitHubPR[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=10`, {
    headers: GH_HEADERS(token),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  interface GHApiPR { id: number; number: number; title: string; html_url: string; state: string; draft: boolean; created_at: string; head?: { sha?: string } }
  const prs = await res.json() as GHApiPR[]
  return Promise.all(prs.map(async (pr): Promise<GitHubPR> => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    repo: `${owner}/${repo}`,
    url: pr.html_url,
    state: pr.state,
    draft: pr.draft ?? false,
    createdAt: pr.created_at,
    ciStatus: pr.head?.sha ? await fetchCiStatus(owner, repo, pr.head.sha, token) : 'unknown',
  })))
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token') ?? process.env.GITHUB_TOKEN ?? ''
  const reposParam = searchParams.get('repos') ?? process.env.GITHUB_REPOS ?? ''

  if (!token) {
    return NextResponse.json({ prs: [], error: 'No GitHub token configured' })
  }

  const repos = reposParam.split(',').map((r) => r.trim()).filter(Boolean)

  if (repos.length === 0) {
    return NextResponse.json({ prs: [], error: 'No repositories configured (set GITHUB_REPOS)' })
  }

  const allPRs = (await Promise.all(
    repos.map(async (fullRepo) => {
      const [owner, repo] = fullRepo.split('/')
      if (!owner || !repo) return []
      return fetchPRsForRepo(owner, repo, token)
    })
  )).flat()

  return NextResponse.json({ prs: allPRs })
}
