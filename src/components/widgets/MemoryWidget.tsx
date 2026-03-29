'use client'

import { useState } from 'react'
import useSWR from 'swr'
import ReactMarkdown from 'react-markdown'
import { useActiveAgent } from '@/lib/active-agent'

type MemFile = 'memory' | 'current' | 'today' | 'yesterday'

const FILE_LABELS: Record<MemFile, string> = {
  memory:    'MEMORY.md',
  current:   'CURRENT.md',
  today:     "Today's log",
  yesterday: "Yesterday's log",
}

interface MemoryResponse {
  content: string
  updatedAt: string
  file: string
  error?: string
}

interface AgentSnapshotResponse {
  snapshot?: {
    memoryFiles?: {
      memory?: string
      current?: string
      today?: string
    }
    timestamp?: number
  }
  online?: boolean
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Not found'), { status: res.status })
  return data
}

export function MemoryWidget() {
  const [selectedFile, setSelectedFile] = useState<MemFile>('current')
  const { activeAgentId } = useActiveAgent()

  // If agent selected → read from agent snapshot
  const snapshotUrl = activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null
  const proxyUrl = !activeAgentId ? `/api/proxy/memory?file=${selectedFile}` : null

  const { data: snapshotData, isLoading: snapshotLoading, mutate: mutateSn } =
    useSWR<AgentSnapshotResponse>(snapshotUrl, fetcher, {
      refreshInterval: 10_000,
      revalidateOnFocus: false,
    })

  const { data: proxyData, error: proxyError, isLoading: proxyLoading, mutate: mutateProxy } =
    useSWR<MemoryResponse>(proxyUrl, fetcher, {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
        if ((err as any)?.status === 404) return
        if (retryCount >= 2) return
        setTimeout(() => revalidate({ retryCount }), 10_000)
      },
    })

  const isLoading = activeAgentId ? snapshotLoading : proxyLoading
  const mutate = activeAgentId ? mutateSn : mutateProxy

  // Extract content from appropriate source
  let content: string | undefined
  let updatedAt: string | undefined
  let errorMsg: string | undefined

  if (activeAgentId && snapshotData) {
    const files = snapshotData.snapshot?.memoryFiles
    if (!files) {
      errorMsg = 'No memory data from agent snapshot yet'
    } else {
      const fileKey = selectedFile === 'yesterday' ? undefined : selectedFile === 'memory' ? 'memory' : selectedFile === 'current' ? 'current' : 'today'
      content = fileKey ? files[fileKey] : undefined
      if (!content) errorMsg = `${FILE_LABELS[selectedFile]} not available from agent`
      updatedAt = snapshotData.snapshot?.timestamp ? new Date(snapshotData.snapshot.timestamp).toISOString() : undefined
    }
  } else if (!activeAgentId) {
    content = proxyData?.content
    updatedAt = proxyData?.updatedAt
    errorMsg = proxyData?.error ?? (proxyError ? 'Not available on this host' : undefined)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800 shrink-0">
        <select
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value as MemFile)}
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 flex-1"
        >
          {(Object.entries(FILE_LABELS) as [MemFile, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button
          onClick={() => void mutate()}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
          title="Refresh"
        >
          ↻
        </button>

        {updatedAt && (
          <span className="text-xs text-zinc-600 font-mono">
            {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}

        {activeAgentId && (
          <span className="text-xs bg-indigo-900/30 text-indigo-400 px-1.5 rounded border border-indigo-800/30">
            agent
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && <div className="text-xs text-zinc-600 animate-pulse">Loading…</div>}
        {!isLoading && errorMsg && (
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{errorMsg}</p>
            {!activeAgentId && (
              <p className="text-xs text-zinc-700">
                Select a connected agent above to read memory files remotely.
              </p>
            )}
          </div>
        )}
        {!isLoading && content && (
          <div className="prose prose-invert prose-xs max-w-none text-xs [&>*]:text-zinc-300 [&>h1]:text-sm [&>h2]:text-xs [&>h3]:text-xs [&_code]:text-xs [&_pre]:text-xs">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
