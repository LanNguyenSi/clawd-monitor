import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

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

async function fetchPRsForRepo(owner: string, repo: string, token: string): Promise<GitHubPR[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=10`, {
    headers: { Authorization: `token ${token}`, 'User-Agent': 'clawd-monitor' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  interface GHApiPR { id: number; number: number; title: string; html_url: string; state: string; draft: boolean; created_at: string }
  const prs = await res.json() as GHApiPR[]
  return prs.map((pr) => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    repo: `${owner}/${repo}`,
    url: pr.html_url,
    state: pr.state,
    draft: pr.draft ?? false,
    createdAt: pr.created_at,
    ciStatus: 'unknown',
  }))
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token') ?? process.env.GITHUB_TOKEN ?? ''
  const reposParam = searchParams.get('repos') ?? 'LanNguyenSi/depsight,LanNguyenSi/project-forge,LanNguyenSi/clawd-monitor'

  if (!token) {
    return NextResponse.json({ prs: [], error: 'No GitHub token configured' })
  }

  const repos = reposParam.split(',').map((r) => r.trim()).filter(Boolean)

  const allPRs = (await Promise.all(
    repos.map(async (fullRepo) => {
      const [owner, repo] = fullRepo.split('/')
      if (!owner || !repo) return []
      return fetchPRsForRepo(owner, repo, token)
    })
  )).flat()

  return NextResponse.json({ prs: allPRs })
}
