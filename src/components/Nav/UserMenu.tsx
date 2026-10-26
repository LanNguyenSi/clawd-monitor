'use client'

import Link from 'next/link'
import { useTheme } from '@/lib/theme'
import { useMenuA11y } from './useMenuA11y'

export function UserMenu() {
  const { theme, toggleTheme } = useTheme()
  const { open, close, onKeyDown, triggerProps, menuProps } = useMenuA11y()

  function handleLogout() {
    void fetch('/api/auth', { method: 'DELETE' }).finally(() => {
      window.location.assign('/login')
    })
  }

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button
        {...triggerProps}
        aria-label="User menu"
        className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
        title="User menu"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </button>

      {open && (
        <>
          <div {...menuProps} aria-label="User menu" className="absolute top-full mt-1 right-0 w-48 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
            {/* Theme toggle */}
            <button
              role="menuitem"
              onClick={() => { toggleTheme(); close() }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="w-4 text-center" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              <kbd className="ml-auto text-zinc-500 dark:text-zinc-400 font-mono">t</kbd>
            </button>

            <div role="separator" className="border-t border-zinc-200 dark:border-zinc-800 my-1" />

            {/* Settings */}
            <Link
              href="/settings"
              role="menuitem"
              onClick={close}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="w-4 text-center" aria-hidden="true">⚙️</span>
              Settings
            </Link>

            <div role="separator" className="border-t border-zinc-200 dark:border-zinc-800 my-1" />

            {/* Logout */}
            <button
              role="menuitem"
              onClick={handleLogout}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-red-700 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="w-4 text-center">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              Logout
            </button>
          </div>

          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={close} />
        </>
      )}
    </div>
  )
}
