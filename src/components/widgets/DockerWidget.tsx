'use client'

import useSWR from 'swr'

interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'unknown'
  uptime: string
  restarts: number
}

interface DockerResponse {
  containers?: DockerContainer[]
  error?: string
}

const STATE_DOT: Record<string, string> = {
  running:    'bg-green-500',
  restarting: 'bg-yellow-500 animate-pulse',
  paused:     'bg-zinc-500',
  exited:     'bg-red-500',
  unknown:    'bg-zinc-700',
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function DockerWidget() {
  const { data, isLoading } = useSWR<DockerResponse>('/api/proxy/docker', fetcher, { refreshInterval: 15_000 })
  const containers = data?.containers ?? []

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {data?.error && !isLoading && containers.length === 0 && (
        <div className="flex items-center justify-center h-full px-4">
          <span className="text-xs text-zinc-600 text-center">{data.error}</span>
        </div>
      )}

      {!isLoading && containers.length > 0 && (
        <div className="overflow-y-auto divide-y divide-zinc-800/50 flex-1">
          {containers.map((c) => (
            <div key={c.id} className="px-3 py-2 hover:bg-zinc-800/20 transition-colors">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATE_DOT[c.state] ?? STATE_DOT.unknown}`} />
                <span className="text-xs font-medium text-zinc-200 truncate flex-1">{c.name}</span>
                {c.restarts > 0 && (
                  <span className="text-xs text-orange-400 shrink-0" title={`${c.restarts} restarts`}>
                    ↺{c.restarts}
                  </span>
                )}
              </div>
              <div className="flex gap-3 mt-0.5 text-xs text-zinc-600 ml-3.5">
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
