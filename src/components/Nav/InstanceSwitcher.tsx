'use client'

import { useState, useEffect } from 'react'
import { getInstances, getActiveInstance, setActiveInstance, saveInstance, removeInstance } from '@/lib/instance'
import type { Instance } from '@/types'

interface Props {
  onSwitch: () => void
}

export function InstanceSwitcher({ onSwitch }: Props) {
  const [open, setOpen] = useState(false)
  const [instances, setInstances] = useState<Instance[]>([])
  const [active, setActive] = useState<Instance | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', gatewayUrl: '', token: '' })

  function refresh() {
    setInstances(getInstances())
    setActive(getActiveInstance())
  }

  useEffect(() => { refresh() }, [])

  function handleSelect(id: string) {
    setActiveInstance(id)
    refresh()
    setOpen(false)
    onSwitch()
  }

  function handleAdd() {
    if (!form.name || !form.gatewayUrl) return
    saveInstance({
      id: `inst-${Date.now()}`,
      name: form.name,
      gatewayUrl: form.gatewayUrl,
      token: form.token,
    })
    setForm({ name: '', gatewayUrl: '', token: '' })
    setAdding(false)
    refresh()
  }

  function handleRemove(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    removeInstance(id)
    refresh()
    onSwitch()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-zinc-400 border border-zinc-800 rounded px-2.5 py-1 hover:border-zinc-600 transition-colors flex items-center gap-1.5 max-w-[180px]"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
        <span className="truncate">{active?.name ?? 'Local OpenClaw'}</span>
        <span className="text-zinc-600 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50">
          <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
            {instances.map((inst) => (
              <div
                key={inst.id}
                onClick={() => handleSelect(inst.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                  inst.id === active?.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${inst.id === active?.id ? 'bg-green-500' : 'bg-zinc-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 truncate">{inst.name}</div>
                  <div className="text-xs text-zinc-600 truncate font-mono">{inst.gatewayUrl}</div>
                </div>
                {inst.id !== 'default' && (
                  <button
                    onClick={(e) => handleRemove(inst.id, e)}
                    className="text-zinc-700 hover:text-red-400 transition-colors text-xs shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 p-2">
            {!adding ? (
              <button
                onClick={() => setAdding(true)}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1.5 transition-colors"
              >
                + Add instance
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  placeholder="Name (e.g. Stone VPS)"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder-zinc-600"
                />
                <input
                  placeholder="Gateway URL (http://...)"
                  value={form.gatewayUrl}
                  onChange={(e) => setForm({ ...form, gatewayUrl: e.target.value })}
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder-zinc-600 font-mono"
                />
                <input
                  placeholder="API Token (optional)"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  type="password"
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder-zinc-600"
                />
                <div className="flex gap-2">
                  <button onClick={handleAdd} className="flex-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded py-1.5 transition-colors">
                    Save
                  </button>
                  <button onClick={() => setAdding(false)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
