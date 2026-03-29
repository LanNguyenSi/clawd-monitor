'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import ReactMarkdown from 'react-markdown'

type MemFile = 'memory' | 'current' | 'today' | 'yesterday'

const FILE_LABELS: Record<MemFile, string> = {
  memory: 'MEMORY.md',
  current: 'CURRENT.md',
  today: "Today's log",
  yesterday: "Yesterday's log",
}

interface MemoryResponse {
  content: string
  updatedAt: string
  file: string
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function MemoryWidget() {
  const [selectedFile, setSelectedFile] = useState<MemFile>('current')

  const { data, error, isLoading, mutate } = useSWR<MemoryResponse>(
    `/api/proxy/memory?file=${selectedFile}`,
    fetcher,
    { refreshInterval: 30_000, onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
      // Don't retry on 404 — file simply doesn't exist on this host
      if (err?.status === 404) return
      if (retryCount >= 2) return
      setTimeout(() => revalidate({ retryCount }), 5000)
    }}
  )

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

        {data?.updatedAt && (
          <span className="text-xs text-zinc-600 font-mono">
            {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && <div className="text-xs text-zinc-600 animate-pulse">Loading…</div>}
        {(error || data?.error) && (
          <div className="flex flex-col gap-1.5 text-xs">
            <p className="text-zinc-500">{data?.error ?? 'Failed to load'}</p>
            <p className="text-zinc-600">
              Set <code className="font-mono bg-zinc-800 px-1 rounded">CLAWD_DIR</code> in your .env to the correct workspace path.
            </p>
          </div>
        )}
        {data?.content && !data.error && (
          <div className="prose prose-invert prose-xs max-w-none text-xs [&>*]:text-zinc-300 [&>h1]:text-sm [&>h2]:text-xs [&>h3]:text-xs [&_code]:text-xs [&_pre]:text-xs">
            <ReactMarkdown>{data.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
