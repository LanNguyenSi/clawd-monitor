'use client'

import useSWR from 'swr'

interface Alert {
  key: string
  timestamp: string
  label: string
}

interface AlertHistoryResponse {
  alerts?: Alert[]
  lastCheck?: string | null
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('de-DE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 60 * 60 * 1000
}

export function AlertHistoryWidget() {
  const { data, isLoading } = useSWR<AlertHistoryResponse>('/api/proxy/alert-history', fetcher, { refreshInterval: 60_000 })
  const alerts = (data?.alerts ?? []).filter((a) => isRecent(a.timestamp))

  return (
    <div className="flex flex-col h-full">
      {data?.lastCheck && (
        <div className="px-3 py-1 border-b border-zinc-800 text-xs text-zinc-600 shrink-0">
          Last check: {formatTime(data.lastCheck)}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {!isLoading && alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <span className="text-lg">🔕</span>
          <span className="text-xs text-zinc-600">{data?.error ?? 'No alerts in last 7 days'}</span>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="overflow-y-auto divide-y divide-zinc-800/50 flex-1">
          {alerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="text-sm">⚠️</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-200 truncate">{alert.label}</div>
                <div className="text-xs text-zinc-600">{formatTime(alert.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
