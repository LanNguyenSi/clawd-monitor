'use client'

import { useState } from 'react'
import { WIDGET_REGISTRY } from '@/lib/widgets'

interface Props {
  onAdd: (widgetId: string) => void
  activeWidgetIds: string[]
}

export function AddWidgetMenu({ onAdd, activeWidgetIds }: Props) {
  const [open, setOpen] = useState(false)

  const available = WIDGET_REGISTRY.filter((w) => !activeWidgetIds.includes(w.id))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        title="Add widget"
      >
        + Widget
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-56 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {available.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 px-3 py-2">All widgets added</p>
          ) : (
            available.map((w) => (
              <button
                key={w.id}
                onClick={() => { onAdd(w.id); setOpen(false) }}
                className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2 transition-colors"
              >
                {w.title}
              </button>
            ))
          )}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
