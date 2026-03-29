'use client'

import useSWR from 'swr'
import type { GatewaySession } from '@/types'

interface SessionsResponse {
  sessions?: GatewaySession[]
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatAge(iso?: string): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diffMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function ModelBadge({ model }: { model?: string }) {
  if (!model) return null
  const short = model.split('/').pop()?.replace('claude-', '') ?? model
  return (
    <span className="text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-700/40 px-1.5 py-0.5 rounded font-mono">
      {short}
    </span>
  )
}

export function AgentStatusWidget() {
  const { data, error, isLoading } = useSWR<SessionsResponse>(
    '/api/proxy/sessions',
    fetcher,
    { refreshInterval: 10_000 }
  )

  const sessions = data?.sessions ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
          </div>
        )}

        {(error || data?.error) && !isLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-zinc-600">
              {data?.error ?? 'Gateway unavailable'}
            </span>
          </div>
        )}

        {!isLoading && !error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-zinc-700 text-lg">💤</span>
            <span className="text-xs text-zinc-600">No active sessions</span>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="divide-y divide-zinc-800/50">
            {sessions.map((s) => (
              <div key={s.sessionKey} className="px-3 py-2 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-mono text-zinc-300 truncate">
                    {s.sessionKey.replace('agent:', '')}
                  </span>
                  <ModelBadge model={s.model} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  {s.lastMessage && (
                    <span className="text-xs text-zinc-600 truncate max-w-[70%]">
                      {s.lastMessage}
                    </span>
                  )}
                  <span className="text-xs text-zinc-700 tabular-nums shrink-0 ml-auto">
                    {formatAge(s.lastActiveAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
