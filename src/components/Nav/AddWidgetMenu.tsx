'use client'

import { WIDGET_REGISTRY } from '@/lib/widgets'
import { useMenuA11y } from './useMenuA11y'

interface Props {
  onAdd: (widgetId: string) => void
  activeWidgetIds: string[]
}

export function AddWidgetMenu({ onAdd, activeWidgetIds }: Props) {
  const { open, close, onKeyDown, triggerProps, menuProps } = useMenuA11y()

  const available = WIDGET_REGISTRY.filter((w) => !activeWidgetIds.includes(w.id))

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button
        {...triggerProps}
        className="text-xs text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-sm px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        title="Add widget"
      >
        + Widget
      </button>

      {open && (
        <div {...menuProps} aria-label="Add widget" className="absolute top-full mt-1 right-0 w-56 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {available.length === 0 ? (
            <p role="none" className="text-xs text-zinc-400 dark:text-zinc-600 px-3 py-2">All widgets added</p>
          ) : (
            available.map((w) => (
              <button
                key={w.id}
                role="menuitem"
                onClick={() => { onAdd(w.id); close() }}
                className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2 transition-colors"
              >
                {w.title}
              </button>
            ))
          )}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" aria-hidden="true" onClick={close} />}
    </div>
  )
}
