'use client'

import { useState, useEffect, useRef } from 'react'
import type { SystemMetrics } from '@/types'

const MAX_POINTS = 60

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 ** 2)
  return `${mb.toFixed(0)} MB`
}

function cpuColor(pct: number): string {
  if (pct >= 80) return 'text-red-400'
  if (pct >= 60) return 'text-yellow-400'
  return 'text-green-400'
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const w = 120
  const h = 28
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / max) * h
    return `${x},${y}`
  })

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  )
}

export function MetricsWidget() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/stream/metrics')
    esRef.current = es

    es.onopen = () => setStatus('connected')
    es.onerror = () => setStatus('error')

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SystemMetrics
        setMetrics(data)
        setStatus('connected')
        setCpuHistory((prev) => {
          const next = [...prev, data.cpu]
          return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next
        })
      } catch {}
    }

    return () => es.close()
  }, [])

  const memPct = metrics && metrics.memTotal > 0
    ? Math.round((metrics.memUsed / metrics.memTotal) * 100)
    : 0

  const memBarColor = memPct >= 80 ? 'bg-red-500' : memPct >= 60 ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-3">
      {status === 'connecting' && (
        <div className="text-xs text-zinc-600 animate-pulse">Connecting…</div>
      )}
      {status === 'error' && (
        <div className="text-xs text-red-400">Metrics unavailable</div>
      )}

      {metrics && (
        <>
          {/* CPU */}
          <div>
            <div className="flex items-end justify-between mb-1">
              <span className="text-xs text-zinc-500">CPU</span>
              <span className={`text-2xl font-bold tabular-nums ${cpuColor(metrics.cpu)}`}>
                {metrics.cpu}%
              </span>
            </div>
            <Sparkline
              data={cpuHistory}
              color={metrics.cpu >= 80 ? '#f87171' : metrics.cpu >= 60 ? '#facc15' : '#4ade80'}
            />
          </div>

          {/* RAM */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-zinc-500">RAM</span>
              <span className="text-xs tabular-nums text-zinc-300">
                {formatBytes(metrics.memUsed)} / {formatBytes(metrics.memTotal)}
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${memBarColor}`}
                style={{ width: `${memPct}%` }}
              />
            </div>
            <div className="text-xs text-zinc-600 mt-0.5 text-right">{memPct}%</div>
          </div>
        </>
      )}
    </div>
  )
}
