'use client'

import { useEffect } from 'react'

/** How long the notice stays before it dismisses itself. */
export const UNDO_NOTICE_MS = 8000

interface Props {
  message: string
  onUndo: () => void
  onDismiss: () => void
}

/**
 * Small non-modal notice with an Undo action. It is a polite live region,
 * dismisses itself after UNDO_NOTICE_MS and on Escape.
 */
export function UndoNotice({ message, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="min-h-6 rounded-sm px-2 font-medium text-blue-700 hover:underline dark:text-blue-400"
      >
        Undo
      </button>
    </div>
  )
}
