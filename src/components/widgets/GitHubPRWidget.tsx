'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'

interface GitHubPR {
  id: number
  number: number
  title: string
  repo: string
  url: string
  draft: boolean
  createdAt: string
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
}

interface PRResponse {
  prs?: GitHubPR[]
  error?: string
}


function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const CI_DOT: Record<string, string> = {
  success: 'bg-green-500',
  failure: 'bg-red-500',
  pending: 'bg-yellow-500 animate-pulse',
  unknown: 'bg-zinc-400 dark:bg-zinc-700',
}

export function GitHubPRWidget() {
  const { data, isLoading } = useSWR<PRResponse>('/api/proxy/github', fetcher, { refreshInterval: 60_000 })
  const prs = data?.prs ?? []

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {data?.error && !isLoading && (
        <div className="flex items-center justify-center h-full px-4">
          <span className="text-xs text-zinc-400 dark:text-zinc-600 text-center">{data.error}</span>
        </div>
      )}

      {!isLoading && !data?.error && prs.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <span className="text-lg">✅</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600">No open PRs</span>
        </div>
      )}

      {prs.length > 0 && (
        <div className="overflow-y-auto divide-y divide-zinc-200/50 dark:divide-zinc-800/50 flex-1">
          {prs.map((pr) => (
            <a
              key={pr.id}
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 px-3 py-2 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/20 transition-colors block"
            >
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${CI_DOT[pr.ciStatus]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-800 dark:text-zinc-200 truncate">
                  {pr.draft && <span className="text-zinc-400 dark:text-zinc-600 mr-1">[draft]</span>}
                  {pr.title}
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-600">
                  {pr.repo} #{pr.number} · {formatAge(pr.createdAt)} ago
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
