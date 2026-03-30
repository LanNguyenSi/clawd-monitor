'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useActiveAgent } from '@/lib/active-agent'
import type { GatewaySession } from '@/types'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: string
}

interface SessionLogResponse {
  messages?: Message[]
  error?: string
}

interface SnapshotResponse {
  snapshot?: { sessions?: GatewaySession[] }
  online?: boolean
  lastSnapshotAt?: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatTime(iso?: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

const ROLE_STYLES: Record<string, string> = {
  user:      'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800/40 text-indigo-900 dark:text-indigo-100',
  assistant: 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/40 text-zinc-800 dark:text-zinc-200',
  system:    'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200',
}

export function SessionLogWidget() {
  const { activeAgentId } = useActiveAgent()
  const [selectedSession, setSelectedSession] = useState<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Get session list from agent snapshot
  const { data: snapshotData } = useSWR<SnapshotResponse>(
    activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null,
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: false }
  )

  const sessions: GatewaySession[] = snapshotData?.snapshot?.sessions ?? []

  // Auto-select first session when list loads
  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0].sessionKey)
    }
  }, [sessions, selectedSession])

  // Fetch session log
  const logUrl = activeAgentId && selectedSession
    ? `/api/agents/${activeAgentId}/session-log?sessionKey=${encodeURIComponent(selectedSession)}&limit=50`
    : null

  const { data: logData, isLoading, error } = useSWR<SessionLogResponse>(
    logUrl,
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false }
  )

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logData, autoScroll])

  // No agent selected
  if (!activeAgentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 px-4">
        <span className="text-xs text-zinc-500 dark:text-zinc-600">Select an agent to view session logs</span>
      </div>
    )
  }

  // Agent offline
  if (snapshotData && !snapshotData.online) {
    const lastSeen = snapshotData.lastSnapshotAt
      ? (() => { const s = Math.floor((Date.now() - snapshotData.lastSnapshotAt!) / 1000); return s < 60 ? `${s}s ago` : `${Math.floor(s/60)}m ago` })()
      : '—'
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 px-4">
        <div className="w-2 h-2 rounded-full bg-zinc-600" />
        <span className="text-xs text-zinc-500">Agent offline</span>
        <span className="text-xs text-zinc-700">last seen {lastSeen}</span>
      </div>
    )
  }

  const messages = logData?.messages ?? []
  const logError = logData?.error ?? (error ? 'Failed to load session log' : null)

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="text-xs bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 flex-1 min-w-0"
        >
          {sessions.length === 0 && <option value="">No sessions</option>}
          {sessions.map((s) => (
            <option key={s.sessionKey} value={s.sessionKey}>
              {s.sessionKey.replace('agent:', '').slice(0, 32)}
            </option>
          ))}
        </select>

        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-xs px-1.5 py-0.5 rounded shrink-0 transition-colors ${
            autoScroll
              ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-600/20 dark:text-indigo-400'
              : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
          }`}
          title="Toggle auto-scroll"
        >↓</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {isLoading && (
          <div className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse px-1">Loading…</div>
        )}

        {!isLoading && logError && (
          <div className="space-y-1 px-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-500">{logError}</p>
            {logError.includes('Gateway') || logError.includes('404') ? (
              <p className="text-xs text-zinc-600 dark:text-zinc-700">
                Session history endpoint not available on this gateway.
              </p>
            ) : null}
          </div>
        )}

        {!isLoading && !logError && messages.length === 0 && selectedSession && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-zinc-500 dark:text-zinc-600">No messages</span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${ROLE_STYLES[msg.role] ?? ROLE_STYLES.assistant}`}
          >
            <div className="flex items-center justify-between mb-0.5 gap-2">
              <span className="font-medium text-xs opacity-60 uppercase tracking-wide">{msg.role}</span>
              {msg.createdAt && (
                <span className="text-xs opacity-40 shrink-0">{formatTime(msg.createdAt)}</span>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words leading-relaxed line-clamp-6">{msg.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
