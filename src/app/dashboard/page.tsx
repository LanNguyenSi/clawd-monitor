'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/Nav/Navbar'
import { WidgetGrid } from '@/components/Grid/WidgetGrid'
import type { ColCount } from '@/types'

const COLS_KEY = 'clawd-monitor:cols'

export default function DashboardPage() {
  const router = useRouter()
  const [cols, setCols] = useState<ColCount>(4)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Auth check
    const token = localStorage.getItem('clawd-monitor:token')
    if (!token) {
      router.replace('/login')
      return
    }

    // Restore cols preference
    const savedCols = localStorage.getItem(COLS_KEY)
    if (savedCols && ['2', '4', '8'].includes(savedCols)) {
      setCols(parseInt(savedCols) as ColCount)
    }

    setReady(true)
  }, [router])

  function handleColsChange(newCols: ColCount) {
    setCols(newCols)
    localStorage.setItem(COLS_KEY, String(newCols))
  }

  if (!ready) return null

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      <Navbar cols={cols} onColsChange={handleColsChange} />
      <div className="flex-1 overflow-auto p-2">
        <WidgetGrid cols={cols} />
      </div>
    </div>
  )
}
