'use client'

import useSWR from 'swr'

interface ServiceResult {
  name: string
  url: string
  ok: boolean
  status: number
  responseMs: number
  checkedAt: string
}

interface HealthResponse {
  services?: ServiceResult[]
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ServiceHealthWidget() {
  const { data, isLoading } = useSWR<HealthResponse>('/api/proxy/health', fetcher, { refreshInterval: 60_000 })
  const services = data?.services ?? []

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-600 animate-pulse">Checking…</span>
        </div>
      )}

      {!isLoading && services.length > 0 && (
        <div className="divide-y divide-zinc-800/50 overflow-y-auto flex-1">
          {services.map((svc) => (
            <div key={svc.name} className="flex items-center gap-3 px-3 py-2.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${svc.ok ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-200">{svc.name}</div>
                <div className="text-xs text-zinc-600">
                  {svc.ok ? `${svc.responseMs}ms` : 'DOWN'}
                  {svc.status > 0 && ` · ${svc.status}`}
                </div>
              </div>
              <span className={`text-xs font-medium ${svc.ok ? 'text-green-400' : 'text-red-400'}`}>
                {svc.ok ? 'UP' : 'DOWN'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
