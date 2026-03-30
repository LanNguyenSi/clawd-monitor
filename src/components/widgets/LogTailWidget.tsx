'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getActiveInstance } from '@/lib/instance'

type LogSource = 'openclaw' | 'docker' | 'system'

interface LogLine {
  id: number
  text: string
  level: 'error' | 'warn' | 'info' | 'debug'
}

const MAX_LINES = 500

function detectLevel(line: string): LogLine['level'] {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('err]') || l.includes('fatal') || l.includes('critical')) return 'error'
  if (l.includes('warn') || l.includes('warning')) return 'warn'
  if (l.includes('debug') || l.includes('trace')) return 'debug'
  return 'info'
}

const LEVEL_CLASSES: Record<LogLine['level'], string> = {
  error: 'text-red-500 dark:text-red-400',
  warn:  'text-yellow-600 dark:text-yellow-400',
  info:  'text-zinc-700 dark:text-zinc-300',
  debug: 'text-zinc-400 dark:text-zinc-600',
}

export function LogTailWidget() {
  const [source, setSource] = useState<LogSource>('openclaw')
  const [container, setContainer] = useState('')
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const lineIdRef = useRef(0)

  const connect = useCallback((src: LogSource, ctr: string) => {
    esRef.current?.close()
    setLines([])
    setStatus('connecting')

    const instance = getActiveInstance()
    const params = new URLSearchParams({ source: src })
    if (src === 'docker' && ctr) params.set('container', ctr)

    // Pass instance config via URL params for client-side SSE
    const url = `/api/stream/logs?${params}`

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setStatus('connected')
    es.onerror = () => setStatus('disconnected')

    es.onmessage = (e) => {
      if (e.data === undefined) return
      let text: string
      try { text = JSON.parse(e.data) as string }
      catch { text = e.data }

      if (!text.trim()) return
      setStatus('connected')

      setLines((prev) => {
        const id = ++lineIdRef.current
        const newLine: LogLine = { id, text, level: detectLevel(text) }
        const next = [...prev, newLine]
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    }

    return () => es.close()
  }, [])

  useEffect(() => {
    const cleanup = connect(source, container)
    return cleanup
  }, [connect, source, container])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as LogSource)}
          className="text-xs bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300"
        >
          <option value="openclaw">OpenClaw</option>
          <option value="docker">Docker</option>
          <option value="system">System</option>
        </select>

        {source === 'docker' && (
          <input
            type="text"
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            onBlur={() => connect('docker', container)}
            placeholder="container name"
            className="text-xs bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded px-2 py-0.5 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 w-32"
          />
        )}

        <div className="flex-1" />

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            autoScroll ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-600/20 dark:text-indigo-400' : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
          }`}
        >
          ↓ auto
        </button>

        {/* Status */}
        <div className={`w-1.5 h-1.5 rounded-full ${
          status === 'connected' ? 'bg-green-500' :
          status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
          'bg-red-500 animate-pulse'
        }`} title={status} />
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed px-2 py-1">
        {status === 'connecting' && lines.length === 0 && (
          <div className="text-zinc-400 dark:text-zinc-600 animate-pulse">Connecting…</div>
        )}
        {status === 'disconnected' && lines.length === 0 && (
          <div className="text-red-500 dark:text-red-400">Disconnected — retrying…</div>
        )}
        {lines.map((line) => (
          <div key={line.id} className={`${LEVEL_CLASSES[line.level]} whitespace-pre-wrap break-all`}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
