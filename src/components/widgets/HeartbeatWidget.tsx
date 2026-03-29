'use client'

import useSWR from 'swr'

interface HeartbeatResponse {
  ok: boolean
  status: number
  responseMs: number | null
  checkedAt: string
  error?: string
  data?: Record<string, unknown>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function getStatus(data?: HeartbeatResponse): 'OK' | 'WARNING' | 'SILENT' {
  if (!data) return 'SILENT'
  if (!data.ok) return 'SILENT'
  const ageMs = Date.now() - new Date(data.checkedAt).getTime()
  if (ageMs > 35 * 60 * 1000) return 'WARNING'
  return 'OK'
}

const STATUS_CONFIG = {
  OK:      { dot: 'bg-green-500',  label: 'OK',      text: 'text-green-400' },
  WARNING: { dot: 'bg-yellow-500 animate-pulse', label: 'WARNING', text: 'text-yellow-400' },
  SILENT:  { dot: 'bg-red-500 animate-pulse',    label: 'SILENT',  text: 'text-red-400' },
}

export function HeartbeatWidget() {
  const { data, isLoading } = useSWR<HeartbeatResponse>(
    '/api/proxy/heartbeat',
    fetcher,
    { refreshInterval: 30_000 }
  )

  const status = getStatus(data)
  const cfg = STATUS_CONFIG[status]

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
        <span className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</span>
      </div>

      {data && (
        <>
          <div className="text-xs text-zinc-500 text-center">
            {data.responseMs != null ? `${data.responseMs}ms` : '—'}
            {' · '}
            {new Date(data.checkedAt).toLocaleTimeString()}
          </div>
          {data.error && (
            <div className="text-xs text-red-400 text-center">{data.error}</div>
          )}
        </>
      )}

      {isLoading && !data && (
        <span className="text-xs text-zinc-600 animate-pulse">Checking…</span>
      )}
    </div>
  )
}
