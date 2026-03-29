'use client'

import { useEffect, useState } from 'react'

interface Props {
  onRefresh: () => void
  onScreenshot: () => void
  onToggleTheme: () => void
  onToggleEditMode: () => void
}

interface ShortcutHelpOverlay {
  visible: boolean
}

const SHORTCUTS = [
  { key: 'r', description: 'Refresh active widget' },
  { key: 's', description: 'Screenshot dashboard (PNG)' },
  { key: 'e', description: 'Toggle edit / lock layout' },
  { key: 't', description: 'Toggle dark / light mode' },
  { key: '?', description: 'Show this help' },
  { key: 'Esc', description: 'Close this help' },
]

export function KeyboardShortcuts({ onRefresh, onScreenshot, onToggleTheme, onToggleEditMode }: Props) {
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'r':
          onRefresh()
          break
        case 's':
          onScreenshot()
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
  }, [onRefresh, onScreenshot, onToggleTheme, onToggleEditMode])

  if (!showHelp) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-200">Keyboard Shortcuts</h2>
          <button onClick={() => setShowHelp(false)} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">{s.description}</span>
              <kbd className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 font-mono text-zinc-300">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-4 text-center">Press ? to toggle</p>
      </div>
    </div>
  )
}
