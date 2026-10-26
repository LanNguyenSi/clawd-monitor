'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Nav/Navbar'
import { WidgetGrid } from '@/components/Grid/WidgetGrid'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ActiveAgentProvider } from '@/lib/active-agent'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { WIDGET_REGISTRY } from '@/lib/widgets'
import { addWidgetToStorage, defaultLayouts, resetLayouts } from '@/lib/layout-storage'
import type { ColCount } from '@/types'

const COLS_KEY = 'clawd-monitor:cols'
const RESET_CONFIRM_MESSAGE = 'Reset the dashboard layout to the default? Your custom arrangement will be lost.'

function DashboardInner() {
  const router = useRouter()
  const { toggleTheme } = useTheme()
  const [cols, setCols] = useState<ColCount>(4)
  const [ready, setReady] = useState(false)
  const [editMode, setEditMode] = useState(true)
  const [gridKey, setGridKey] = useState(0)
  const [activeWidgetIds, setActiveWidgetIds] = useState<string[]>([])

  useEffect(() => {
    let mounted = true

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth')
        if (!res.ok) {
          router.replace('/login')
          return
        }

        const data = await res.json() as { authenticated?: boolean }
        if (!data.authenticated) {
          router.replace('/login')
          return
        }

        if (!mounted) {
          return
        }

        const savedCols = localStorage.getItem(COLS_KEY)
        if (savedCols && ['2', '4', '8'].includes(savedCols)) {
          setCols(parseInt(savedCols) as ColCount)
        }

        setReady(true)
      } catch {
        router.replace('/login')
      }
    }

    void checkAuth()

    // Periodically revalidate auth to catch expired sessions
    const authInterval = setInterval(() => {
      void fetch('/api/auth').then((res) => {
        if (res.status === 401) {
          window.location.href = '/login'
        }
      }).catch(() => {
        // Network error — ignore, retry on next interval
      })
    }, 60_000)

    return () => {
      mounted = false
      clearInterval(authInterval)
    }
  }, [router])

  const handleColsChange = useCallback((newCols: ColCount) => {
    setCols(newCols)
    localStorage.setItem(COLS_KEY, String(newCols))
  }, [])

  const handleRefresh = useCallback(() => {
    setGridKey((k) => k + 1)
  }, [])

  const handleAddWidget = useCallback((widgetId: string) => {
    const widget = WIDGET_REGISTRY.find((w) => w.id === widgetId)
    if (!widget) return
    addWidgetToStorage(localStorage, widget, new Set(WIDGET_REGISTRY.map((w) => w.id)), defaultLayouts(cols))
    setGridKey((k) => k + 1)
  }, [cols])

  const handleResetLayout = useCallback(() => {
    if (!window.confirm(RESET_CONFIRM_MESSAGE)) return
    resetLayouts(localStorage)
    setGridKey((k) => k + 1)
  }, [])

  const handleToggleEditMode = useCallback(() => {
    setEditMode((v) => !v)
  }, [])

  if (!ready) return null

  return (
    <div
      className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950"
    >
      <Navbar
        cols={cols}
        onColsChange={handleColsChange}
        editMode={editMode}
        onToggleEditMode={handleToggleEditMode}
        onAddWidget={handleAddWidget}
        onResetLayout={handleResetLayout}
        activeWidgetIds={activeWidgetIds}
      />
      <main className="flex-1 overflow-auto p-2">
        <h1 className="sr-only">Dashboard</h1>
        <WidgetGrid
          key={gridKey}
          cols={cols}
          editMode={editMode}
          onLayoutChange={setActiveWidgetIds}
        />

        {/* Help hint */}
        <div className="mt-3 text-right text-xs text-zinc-500 dark:text-zinc-400 select-none">
          Press <kbd className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-sm px-1">?</kbd> for shortcuts
        </div>
      </main>

      <KeyboardShortcuts
        onRefresh={handleRefresh}
        onToggleTheme={toggleTheme}
        onToggleEditMode={handleToggleEditMode}
      />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <ThemeProvider>
      <ActiveAgentProvider>
        <DashboardInner />
      </ActiveAgentProvider>
    </ThemeProvider>
  )
}
