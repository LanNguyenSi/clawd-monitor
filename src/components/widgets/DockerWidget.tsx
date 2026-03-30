'use client'

import useSWR from 'swr'
import { useActiveAgent } from '@/lib/active-agent'

interface DockerContainer {
  id: string; name: string; image: string
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'unknown'
  restarts: number; uptime: string
}

interface DockerResponse { containers?: DockerContainer[]; error?: string }
interface SnapshotResponse { snapshot?: { containers?: DockerContainer[] }; online?: boolean; lastSnapshotAt?: number }

const STATE_DOT: Record<string, string> = {
  running: 'bg-green-500', restarting: 'bg-yellow-500 animate-pulse',
  paused: 'bg-zinc-400 dark:bg-zinc-500', exited: 'bg-red-500', unknown: 'bg-zinc-400 dark:bg-zinc-700',
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function DockerWidget() {
  const { activeAgentId } = useActiveAgent()

  const snapshotUrl = activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null
  const proxyUrl = !activeAgentId ? '/api/proxy/docker' : null

  const { data: snapshotData, isLoading: snLoading } = useSWR<SnapshotResponse>(snapshotUrl, fetcher, { refreshInterval: 5_000, revalidateOnFocus: false })
  const { data: proxyData, isLoading: prLoading } = useSWR<DockerResponse>(proxyUrl, fetcher, { refreshInterval: 15_000 })

  const isLoading = activeAgentId ? snLoading : prLoading
  const containers: DockerContainer[] = activeAgentId
    ? (snapshotData?.snapshot?.containers as DockerContainer[] ?? [])
    : (proxyData?.containers ?? [])
  const errorMsg = !activeAgentId && proxyData?.error

  if (activeAgentId && snapshotData && !snapshotData.online) {
    const lastSeen = snapshotData.lastSnapshotAt ? (() => { const s = Math.floor((Date.now() - snapshotData.lastSnapshotAt!) / 1000); return s < 60 ? `${s}s ago` : `${Math.floor(s/60)}m ago` })() : '—'
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 px-4">
        <div className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-600" />
        <span className="text-xs text-zinc-500">Agent offline</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-700">last seen {lastSeen}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {!isLoading && errorMsg && containers.length === 0 && (
        <div className="flex items-center justify-center h-full px-4">
          <div className="text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-600">{errorMsg}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-700 mt-1">Select an agent to view Docker containers</p>
          </div>
        </div>
      )}

      {!isLoading && containers.length > 0 && (
        <div className="overflow-y-auto divide-y divide-zinc-200/50 dark:divide-zinc-800/50 flex-1">
          {containers.map((c) => (
            <div key={c.id} className="px-3 py-2 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/20 transition-colors">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATE_DOT[c.state] ?? STATE_DOT.unknown}`} />
                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate flex-1">{c.name}</span>
                {c.restarts > 0 && (
                  <span className="text-xs text-orange-500 dark:text-orange-400 shrink-0" title={`${c.restarts} restarts`}>↺{c.restarts}</span>
                )}
              </div>
              <div className="flex gap-3 mt-0.5 text-xs text-zinc-400 dark:text-zinc-600 ml-3.5">
                <span className="font-mono truncate">{c.image}</span>
                <span className="shrink-0">{c.uptime}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
