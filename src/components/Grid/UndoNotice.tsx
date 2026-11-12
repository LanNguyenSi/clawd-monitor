'use client'

import { useEffect, useRef, useState } from 'react'

/** How long the notice stays before it dismisses itself. */
export const UNDO_NOTICE_MS = 8000

export interface UndoNoticeContent {
  /** Changes with every notice so the timer and focus restart. */
  key: number
  message: string
}

interface Props {
  notice: UndoNoticeContent | null
  onUndo: () => void
  onDismiss: (reason: 'escape' | 'expired') => void
}

function NoticeBox({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: Props['onDismiss'] }) {
  // The timer pauses while the pointer is over the notice or focus is inside it.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const undoRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    undoRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => onDismiss('expired'), UNDO_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [paused, onDismiss])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Leave Escape to an open dialog.
      if (document.querySelector('[aria-modal="true"]')) return
      onDismiss('escape')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      className="pointer-events-auto flex w-max max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <span>{message}</span>
      <button
        ref={undoRef}
        type="button"
        onClick={onUndo}
        className="min-h-6 rounded-sm px-2 font-medium text-blue-700 hover:underline dark:text-blue-400"
      >
        Undo
      </button>
    </div>
  )
}

/**
 * Non-modal notice with an Undo action. The polite live region stays mounted
 * and only its content changes, so screen readers announce each notice.
 */
export function UndoNotice({ notice, onUndo, onDismiss }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-undo-notice=""
      className="pointer-events-none fixed bottom-4 left-0 right-0 z-50 flex justify-center px-4"
    >
      {notice && <NoticeBox key={notice.key} message={notice.message} onUndo={onUndo} onDismiss={onDismiss} />}
    </div>
  )
}
