'use client'

import { useRouter } from 'next/navigation'
import { AgentSwitcher } from './AgentSwitcher'
import { AddWidgetMenu } from './AddWidgetMenu'
import type { ColCount } from '@/types'

interface Props {
  cols: ColCount
  onColsChange: (cols: ColCount) => void
  onInstanceSwitch?: () => void  // kept for backward compat
  onToggleTheme?: () => void
  theme?: 'dark' | 'light'
  editMode?: boolean
  onToggleEditMode?: () => void
  onAddWidget?: (widgetId: string) => void
  activeWidgetIds?: string[]
}

export function Navbar({ cols, onColsChange, onInstanceSwitch, onToggleTheme, theme, editMode, onToggleEditMode, onAddWidget, activeWidgetIds = [] }: Props) {
  const router = useRouter()

  function handleLogout() {
    localStorage.removeItem('clawd-monitor:token')
    document.cookie = 'token=; Max-Age=0; path=/'
    router.push('/login')
  }

  return (
    <nav className="h-12 border-b border-zinc-800 bg-zinc-950 dark:bg-zinc-950 flex items-center px-4 gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm">🐾</span>
        <span className="text-sm font-semibold text-zinc-200">clawd-monitor</span>
      </div>

      <div className="flex-1" />

      {/* Edit mode toggle */}
      {onToggleEditMode && (
        <button
          onClick={onToggleEditMode}
          className={`text-xs px-2 py-1 rounded transition-colors border ${
            editMode
              ? 'border-indigo-600/40 bg-indigo-600/10 text-indigo-400'
              : 'border-zinc-800 text-zinc-600 hover:text-zinc-400'
          }`}
          title={editMode ? 'Lock layout (e)' : 'Edit layout (e)'}
        >
          {editMode ? '✏️ editing' : '🔒 locked'}
        </button>
      )}

      {/* Layout selector */}
      <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
        {([2, 4, 8] as ColCount[]).map((c) => (
          <button
            key={c}
            onClick={() => onColsChange(c)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              cols === c ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {onAddWidget && (
        <AddWidgetMenu onAdd={onAddWidget} activeWidgetIds={activeWidgetIds} />
      )}
      <AgentSwitcher />

      {/* Theme toggle */}
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-6 text-center"
          title="Toggle theme (t)"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      )}

      <a
        href="/settings"
        className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
      >
        ⚙
      </a>

      <button
        onClick={handleLogout}
        className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
      >
        out
      </button>
    </nav>
  )
}
