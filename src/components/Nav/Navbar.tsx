'use client'

import { useState } from 'react'
import { AgentSwitcher } from './AgentSwitcher'
import { AddWidgetMenu } from './AddWidgetMenu'
import { UserMenu } from './UserMenu'
import type { ColCount } from '@/types'

interface Props {
  cols: ColCount
  onColsChange: (cols: ColCount) => void
  editMode?: boolean
  onToggleEditMode?: () => void
  onAddWidget?: (widgetId: string) => void
  activeWidgetIds?: string[]
}

export function Navbar({ cols, onColsChange, editMode, onToggleEditMode, onAddWidget, activeWidgetIds = [] }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 shrink-0">
      <div className="h-12 flex items-center px-4 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🐾</span>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 hidden sm:inline">clawd-monitor</span>
        </div>

        <div className="flex-1" />

        {/* Desktop controls */}
        <div className="hidden md:flex items-center gap-3">
          {onToggleEditMode && (
            <button
              onClick={onToggleEditMode}
              className={`text-xs px-2 py-1 rounded transition-colors border ${
                editMode
                  ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:border-indigo-600/40 dark:bg-indigo-600/10 dark:text-indigo-400'
                  : 'border-zinc-300 text-zinc-500 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-600 dark:hover:text-zinc-400'
              }`}
              title={editMode ? 'Lock layout (e)' : 'Edit layout (e)'}
            >
              {editMode ? '✏️ editing' : '🔒 locked'}
            </button>
          )}

          <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-0.5">
            {([2, 4, 8] as ColCount[]).map((c) => (
              <button
                key={c}
                onClick={() => onColsChange(c)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  cols === c
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                }`}
                title={`${c} columns`}
              >
                {c}
              </button>
            ))}
          </div>

          {onAddWidget && (
            <AddWidgetMenu onAdd={onAddWidget} activeWidgetIds={activeWidgetIds} />
          )}
        </div>

        <AgentSwitcher />
        <UserMenu />

        {/* Mobile menu toggle for layout controls */}
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="md:hidden text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors px-1"
          title="Layout controls"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile layout controls */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-3">
            {onToggleEditMode && (
              <button
                onClick={onToggleEditMode}
                className={`text-xs px-2 py-1 rounded transition-colors border ${
                  editMode
                    ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:border-indigo-600/40 dark:bg-indigo-600/10 dark:text-indigo-400'
                    : 'border-zinc-300 text-zinc-500 dark:border-zinc-800 dark:text-zinc-600'
                }`}
              >
                {editMode ? '✏️ editing' : '🔒 locked'}
              </button>
            )}

            <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-0.5">
              {([2, 4, 8] as ColCount[]).map((c) => (
                <button
                  key={c}
                  onClick={() => onColsChange(c)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    cols === c
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 dark:text-zinc-500'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {onAddWidget && (
              <AddWidgetMenu onAdd={onAddWidget} activeWidgetIds={activeWidgetIds} />
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
