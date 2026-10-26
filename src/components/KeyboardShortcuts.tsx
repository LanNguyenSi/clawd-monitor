'use client'

import { useEffect, useId, useRef, useState } from 'react'

interface Props {
  onRefresh: () => void
  onToggleTheme: () => void
  onToggleEditMode: () => void
}

interface ShortcutHelpOverlay {
  visible: boolean
}

const SHORTCUTS = [
  { key: 'r', description: 'Refresh active widget' },
  { key: 'e', description: 'Toggle edit / lock layout' },
  { key: 't', description: 'Toggle dark / light mode' },
  { key: '?', description: 'Show this help' },
  { key: 'Esc', description: 'Close this help' },
]

export function KeyboardShortcuts({ onRefresh, onToggleTheme, onToggleEditMode }: Props) {
  const [showHelp, setShowHelp] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // Move focus into the dialog while it is open and hand it back to whatever
  // had it before (the cleanup runs on close and on unmount).
  useEffect(() => {
    if (!showHelp) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => {
      previous?.focus?.()
    }
  }, [showHelp])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'r':
          onRefresh()
          break
        case 'e':
          onToggleEditMode()
          break
        case 't':
          onToggleTheme()
          break
        case '?':
          setShowHelp((v) => !v)
          break
        case 'Escape':
          setShowHelp(false)
          break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onRefresh, onToggleTheme, onToggleEditMode])

  if (!showHelp) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false) }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // The close button is the only tabbable element: keep Tab inside.
          if (e.key === 'Tab') {
            e.preventDefault()
            closeRef.current?.focus()
          }
        }}
        className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-xl p-6 w-80 shadow-2xl focus:outline-hidden">
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Keyboard Shortcuts</h2>
          <button
            ref={closeRef}
            onClick={() => setShowHelp(false)}
            aria-label="Close keyboard shortcuts"
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300"
          >✕</button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{s.description}</span>
              <kbd className="text-xs bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-sm px-2 py-0.5 font-mono text-zinc-700 dark:text-zinc-300">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-4 text-center">Press ? to toggle</p>
      </div>
    </div>
  )
}
