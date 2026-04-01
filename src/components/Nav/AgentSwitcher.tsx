'use client'

import { useState, useEffect } from 'react'
import { useActiveAgent } from '@/lib/active-agent'

interface AgentEntry {
  agentId: string
  name: string
  online: boolean
  lastSnapshotAt: number
}

const STORAGE_KEY = 'clawd-monitor:activeAgentId'

function formatAge(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return `${m}m ago`
}

export function AgentSwitcher() {
  const { activeAgentId, setActiveAgentId } = useActiveAgent()
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  // Poll agent list every 5s
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await fetch('/api/agents/list')
        if (!res.ok) return
        const data = await res.json() as { agents?: AgentEntry[] }
        if (mounted) setAgents(data.agents ?? [])
      } catch {}
    }
    void load()
    const interval = setInterval(() => void load(), 5000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  // Restore active agent from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) setActiveAgentId(saved)
  }, [setActiveAgentId])

  function select(id: string | null) {
    setActiveAgentId(id)
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
    setOpen(false)
  }

  async function removeAgent(e: React.MouseEvent, agentId: string) {
    e.stopPropagation()
    setRemoving(agentId)
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      })
      if (activeAgentId === agentId) select(null)
      setAgents((prev) => prev.filter((a) => a.agentId !== agentId))
    } finally {
      setRemoving(null)
    }
  }

  const activeAgent = agents.find((a) => a.agentId === activeAgentId)
  const onlineCount = agents.filter((a) => a.online).length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors max-w-[160px]"
      >
        {activeAgent ? (
          <>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeAgent.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-500'}`} />
            <span className="truncate text-zinc-700 dark:text-zinc-300">{activeAgent.name}</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0" />
            <span className="text-zinc-500">All agents</span>
            {onlineCount > 0 && <span className="text-zinc-400 dark:text-zinc-700 tabular-nums">({onlineCount})</span>}
          </>
        )}
        <span className="text-zinc-400 dark:text-zinc-700 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-60 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {/* All agents option */}
          <button
            onClick={() => select(null)}
            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${!activeAgentId ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0" />
            All agents
          </button>

          {agents.length > 0 && <div className="border-t border-zinc-200 dark:border-zinc-800 my-1" />}

          {agents.map((agent) => (
            <div
              key={agent.agentId}
              className={`flex items-center gap-1 px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${activeAgentId === agent.agentId ? 'bg-zinc-100 dark:bg-zinc-800/60' : ''}`}
            >
              <button
                onClick={() => select(agent.agentId)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${activeAgentId === agent.agentId ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {agent.name}
                  </div>
                  <div className="text-zinc-400 dark:text-zinc-600 text-xs">
                    {agent.online ? `online · ${formatAge(agent.lastSnapshotAt)}` : `offline · ${formatAge(agent.lastSnapshotAt)}`}
                  </div>
                </div>
              </button>
              {!agent.online && (
                <button
                  onClick={(e) => void removeAgent(e, agent.agentId)}
                  disabled={removing === agent.agentId}
                  title="Remove offline agent"
                  className="shrink-0 text-zinc-400 dark:text-zinc-700 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1 disabled:opacity-40"
                >
                  {removing === agent.agentId ? '…' : '✕'}
                </button>
              )}
            </div>
          ))}

          {agents.length === 0 && (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 px-3 py-2">No agents connected</p>
          )}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
