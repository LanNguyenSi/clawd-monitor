'use client'

import { useState, useEffect } from 'react'
import { useActiveAgent } from '@/lib/active-agent'
import { useMenuA11y } from './useMenuA11y'

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
  const { open, close, onKeyDown, triggerProps, menuProps } = useMenuA11y()
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
    close()
  }

  // The remove button unmounts together with its row. Hand focus to the
  // nearest remaining menu item first (the one after the row, else the last
  // one before it), so the menu keeps handling Arrow keys, Escape and Tab
  // instead of focus dropping to <body>.
  function focusNeighbour(removed: HTMLElement) {
    const row = removed.parentElement
    const items = Array.from(
      menuProps.ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    ).filter((el) => !row?.contains(el))
    const after = items.find((el) => row && row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    ;(after ?? items[items.length - 1])?.focus()
  }

  async function removeAgent(e: React.MouseEvent<HTMLButtonElement>, agentId: string) {
    e.stopPropagation()
    const button = e.currentTarget
    setRemoving(agentId)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      })
      // 404: already gone from the registry; drop it locally too. Any other
      // failure (401, 409 agent came back online) keeps the entry listed.
      if (!res.ok && res.status !== 404) return
      // Removing the selected agent selects "All agents", which closes the
      // menu and refocuses the trigger; otherwise the menu stays open.
      if (activeAgentId === agentId) select(null)
      else focusNeighbour(button)
      setAgents((prev) => prev.filter((a) => a.agentId !== agentId))
    } finally {
      setRemoving(null)
    }
  }

  const activeAgent = agents.find((a) => a.agentId === activeAgentId)
  const onlineCount = agents.filter((a) => a.online).length

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button
        {...triggerProps}
        className="flex items-center gap-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded-sm px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors max-w-[160px]"
      >
        {activeAgent ? (
          <>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeAgent.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-500'}`} />
            <span className="truncate text-zinc-700 dark:text-zinc-300">{activeAgent.name}</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0" />
            <span className="text-zinc-500 dark:text-zinc-400">All agents</span>
            {onlineCount > 0 && <span className="text-zinc-500 dark:text-zinc-400 tabular-nums">({onlineCount})</span>}
          </>
        )}
        <span aria-hidden="true" className="text-zinc-500 dark:text-zinc-400 shrink-0">▾</span>
      </button>

      {open && (
        <div {...menuProps} aria-label="Select agent" className="absolute top-full mt-1 right-0 w-60 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {/* All agents option */}
          <button
            role="menuitem"
            onClick={() => select(null)}
            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${!activeAgentId ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0" />
            All agents
          </button>

          {agents.length > 0 && <div role="separator" className="border-t border-zinc-200 dark:border-zinc-800 my-1" />}

          {agents.map((agent) => (
            <div
              key={agent.agentId}
              role="none"
              className={`flex items-center gap-1 px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${activeAgentId === agent.agentId ? 'bg-zinc-100 dark:bg-zinc-800/60' : ''}`}
            >
              <button
                role="menuitem"
                onClick={() => select(agent.agentId)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${activeAgentId === agent.agentId ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {agent.name}
                  </div>
                  <div className="text-zinc-500 dark:text-zinc-400 text-xs">
                    {agent.online ? `online · ${formatAge(agent.lastSnapshotAt)}` : `offline · ${formatAge(agent.lastSnapshotAt)}`}
                  </div>
                </div>
              </button>
              {!agent.online && (
                <button
                  role="menuitem"
                  onClick={(e) => void removeAgent(e, agent.agentId)}
                  disabled={removing === agent.agentId}
                  aria-label={`Remove offline agent ${agent.name}`}
                  title="Remove offline agent"
                  className="shrink-0 min-w-6 min-h-6 inline-flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1 disabled:opacity-40"
                >
                  <span aria-hidden="true">{removing === agent.agentId ? '…' : '✕'}</span>
                </button>
              )}
            </div>
          ))}

          {agents.length === 0 && (
            <p role="none" className="text-xs text-zinc-500 dark:text-zinc-400 px-3 py-2">No agents connected</p>
          )}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" aria-hidden="true" onClick={close} />}
    </div>
  )
}
