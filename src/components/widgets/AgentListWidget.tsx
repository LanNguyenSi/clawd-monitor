'use client'

import useSWR from 'swr'
import { useActiveAgent } from '@/lib/active-agent'

interface AgentEntry {
  agentId: string
  name: string
  version: string
  connectedAt: number
  lastSnapshotAt: number
  lastSnapshot: {
    sessions: unknown[]
    cronJobs: unknown[]
  } | null
  online: boolean
}

interface AgentListResponse {
  agents?: AgentEntry[]
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatAge(ms: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return `${m}m ago`
}

export function AgentListWidget() {
  const { data, isLoading } = useSWR<AgentListResponse>('/api/agents/list', fetcher, {
    refreshInterval: 5000,
  })
  const { activeAgentId, setActiveAgentId } = useActiveAgent()
  const agents = data?.agents ?? []

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {!isLoading && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
          <span className="text-2xl">🔌</span>
          <p className="text-xs text-zinc-400 dark:text-zinc-600">No agents connected</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-700">
            Run <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">clawd-monitor-agent --server ...</code> on your OpenClaw VPS
          </p>
        </div>
      )}

      {agents.length > 0 && (
        <div className="divide-y divide-zinc-200/50 dark:divide-zinc-800/50 overflow-y-auto flex-1">
          {agents.map((agent) => {
            const isActive = activeAgentId === agent.agentId
            return (
              <button
                key={agent.agentId}
                onClick={() => setActiveAgentId(isActive ? null : agent.agentId)}
                className={`w-full text-left px-3 py-2.5 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors ${
                  isActive ? 'bg-indigo-50 border-l-2 border-indigo-500 dark:bg-indigo-900/20' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    agent.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'
                  }`} />
                  <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex-1 truncate">
                    {agent.name}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600 shrink-0">
                    {agent.online ? formatAge(agent.lastSnapshotAt) : 'offline'}
                  </span>
                </div>
                {agent.lastSnapshot && (
                  <div className="flex gap-3 mt-0.5 text-xs text-zinc-400 dark:text-zinc-600 ml-4">
                    <span>{agent.lastSnapshot.sessions?.length ?? 0} sessions</span>
                    <span>{agent.lastSnapshot.cronJobs?.length ?? 0} crons</span>
                    <span className="font-mono text-zinc-400 dark:text-zinc-700">v{agent.version}</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
