'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Nav/Navbar'
import { WidgetGrid } from '@/components/Grid/WidgetGrid'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ActiveAgentProvider } from '@/lib/active-agent'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { WIDGET_REGISTRY } from '@/lib/widgets'
import type { ColCount } from '@/types'

const COLS_KEY = 'clawd-monitor:cols'

function DashboardInner() {
  const router = useRouter()
  const { toggleTheme } = useTheme()
  const [cols, setCols] = useState<ColCount>(4)
  const [ready, setReady] = useState(false)
  const [editMode, setEditMode] = useState(true)
  const [gridKey, setGridKey] = useState(0)
  const [activeWidgetIds, setActiveWidgetIds] = useState<string[]>([])
  const dashboardRef = useRef<HTMLDivElement>(null)

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
        if (!res.ok || res.status === 401) {
          router.replace('/login')
        }
      }).catch(() => {
        router.replace('/login')
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
    const STORAGE_KEY = 'clawd-monitor:layouts'
    const widget = WIDGET_REGISTRY.find((w) => w.id === widgetId)
    if (!widget) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      const layouts = saved ? JSON.parse(saved) as { i: string; x: number; y: number; w: number; h: number }[] : []
      const maxY = layouts.reduce((max, l) => Math.max(max, l.y + l.h), 0)
      layouts.push({ i: widgetId, x: 0, y: maxY, w: widget.defaultW, h: widget.defaultH })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
      setGridKey((k) => k + 1)
    } catch {}
  }, [])

  const handleScreenshot = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: html2canvas } = await import('html2canvas' as any)
      const canvas = await html2canvas(dashboardRef.current ?? document.body, { useCORS: true })
      const link = document.createElement('a')
      link.download = `clawd-monitor-${new Date().toISOString().slice(0, 19)}.png`
      link.href = canvas.toDataURL()
      link.click()
    } catch {
      console.warn('Screenshot: html2canvas not available')
    }
  }, [])

  const handleToggleEditMode = useCallback(() => {
    setEditMode((v) => !v)
  }, [])

  if (!ready) return null

  return (
    <div
      ref={dashboardRef}
      className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950"
    >
      <Navbar
        cols={cols}
        onColsChange={handleColsChange}
        editMode={editMode}
        onToggleEditMode={handleToggleEditMode}
        onAddWidget={handleAddWidget}
        activeWidgetIds={activeWidgetIds}
      />
      <div className="flex-1 overflow-auto p-2">
        <WidgetGrid
          key={gridKey}
          cols={cols}
          editMode={editMode}
          onLayoutChange={setActiveWidgetIds}
        />
      </div>

      <KeyboardShortcuts
        onRefresh={handleRefresh}
        onScreenshot={handleScreenshot}
        onToggleTheme={toggleTheme}
        onToggleEditMode={handleToggleEditMode}
      />

      {/* Help hint */}
      <div className="fixed bottom-3 right-3 text-xs text-zinc-400 dark:text-zinc-700 select-none">
        Press <kbd className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded px-1">?</kbd> for shortcuts
      </div>
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
