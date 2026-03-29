'use client'

import useSWR from 'swr'
import { useActiveAgent } from '@/lib/active-agent'
import type { GatewaySession } from '@/types'

interface SessionsResponse {
  sessions?: GatewaySession[]
  error?: string
}

interface SnapshotResponse {
  snapshot?: { sessions?: GatewaySession[]; timestamp?: number }
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
  const { activeAgentId } = useActiveAgent()

  const snapshotUrl = activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null
  const proxyUrl = !activeAgentId ? '/api/proxy/sessions' : null

  const { data: snapshotData, isLoading: snLoading } = useSWR<SnapshotResponse>(snapshotUrl, fetcher, { refreshInterval: 10_000, revalidateOnFocus: false })
  const { data: proxyData, isLoading: prLoading } = useSWR<SessionsResponse>(proxyUrl, fetcher, { refreshInterval: 10_000 })

  const isLoading = activeAgentId ? snLoading : prLoading
  const sessions: GatewaySession[] = activeAgentId
    ? (snapshotData?.snapshot?.sessions as GatewaySession[] ?? [])
    : (proxyData?.sessions ?? [])

  const errorMsg = !activeAgentId && proxyData?.error

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {!isLoading && errorMsg && (
        <div className="flex items-center justify-center h-full px-4">
          <div className="text-center">
            <p className="text-xs text-zinc-600">{errorMsg}</p>
            <p className="text-xs text-zinc-700 mt-1">Select a connected agent to view sessions</p>
          </div>
        </div>
      )}

      {!isLoading && !errorMsg && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <span className="text-zinc-700 text-lg">💤</span>
          <span className="text-xs text-zinc-600">No active sessions</span>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="divide-y divide-zinc-800/50 overflow-y-auto flex-1">
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
                  <span className="text-xs text-zinc-600 truncate max-w-[70%]">{s.lastMessage}</span>
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
  )
}
