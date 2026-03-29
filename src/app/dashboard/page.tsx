'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Nav/Navbar'
import { WidgetGrid } from '@/components/Grid/WidgetGrid'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ActiveAgentProvider } from '@/lib/active-agent'
import type { ColCount } from '@/types'

const COLS_KEY = 'clawd-monitor:cols'
const THEME_KEY = 'clawd-monitor:theme'

export default function DashboardPage() {
  const router = useRouter()
  const [cols, setCols] = useState<ColCount>(4)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [editMode, setEditMode] = useState(true)
  const [gridKey, setGridKey] = useState(0)
  const dashboardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const token = localStorage.getItem('clawd-monitor:token')
    if (!token) { router.replace('/login'); return }

    const savedCols = localStorage.getItem(COLS_KEY)
    if (savedCols && ['2', '4', '8'].includes(savedCols)) {
      setCols(parseInt(savedCols) as ColCount)
    }

    const savedTheme = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null
    if (savedTheme) setTheme(savedTheme)

    setReady(true)
  }, [router])

  // Apply theme to html element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const handleColsChange = useCallback((newCols: ColCount) => {
    setCols(newCols)
    localStorage.setItem(COLS_KEY, String(newCols))
  }, [])

  const handleToggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      return next
    })
  }, [])

  const handleRefresh = useCallback(() => {
    setGridKey((k) => k + 1)
  }, [])

  const handleScreenshot = useCallback(async () => {
    try {
      const { default: html2canvas } = await import('html2canvas' as any)
      const canvas = await html2canvas(dashboardRef.current ?? document.body, { useCORS: true })
      const link = document.createElement('a')
      link.download = `clawd-monitor-${new Date().toISOString().slice(0, 19)}.png`
      link.href = canvas.toDataURL()
      link.click()
    } catch {
      // html2canvas not installed — fallback
      console.warn('Screenshot: html2canvas not available')
    }
  }, [])

  const handleToggleEditMode = useCallback(() => {
    setEditMode((v) => !v)
  }, [])

  if (!ready) return null

  return (
    <ActiveAgentProvider>
    <div
      ref={dashboardRef}
      className={`flex flex-col h-screen ${theme === 'dark' ? 'bg-zinc-950' : 'bg-zinc-100'}`}
    >
      <Navbar
        cols={cols}
        onColsChange={handleColsChange}
        onInstanceSwitch={handleRefresh}
        onToggleTheme={handleToggleTheme}
        theme={theme}
        editMode={editMode}
        onToggleEditMode={handleToggleEditMode}
      />
      <div className="flex-1 overflow-auto p-2">
        <WidgetGrid key={gridKey} cols={cols} editMode={editMode} />
      </div>

      <KeyboardShortcuts
        onRefresh={handleRefresh}
        onScreenshot={handleScreenshot}
        onToggleTheme={handleToggleTheme}
        onToggleEditMode={handleToggleEditMode}
      />

      {/* Help hint */}
      <div className="fixed bottom-3 right-3 text-xs text-zinc-700 select-none">
        Press <kbd className="bg-zinc-900 border border-zinc-800 rounded px-1">?</kbd> for shortcuts
      </div>
    </div>
    </ActiveAgentProvider>
  )
}
