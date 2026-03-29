'use client'

import { useState, useEffect, useCallback } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { GridItem } from './GridItem'
import { WIDGET_REGISTRY } from '@/lib/widgets'
import type { ColCount, GridLayout } from '@/types'

// Placeholder widgets until real ones are built
function PlaceholderWidget({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
      <span className="text-2xl">📦</span>
      <span className="text-xs">{title}</span>
      <span className="text-xs text-zinc-700 font-mono">{id}</span>
    </div>
  )
}

const ResponsiveGrid = WidthProvider(Responsive)

const STORAGE_KEY = 'clawd-monitor:layouts'
const COLS_KEY = 'clawd-monitor:cols'

const DEFAULT_WIDGET_IDS = ['log-tail', 'metrics', 'memory', 'agent-status']

function defaultLayouts(cols: ColCount): Layout[] {
  return DEFAULT_WIDGET_IDS.map((id, i) => {
    const w = WIDGET_REGISTRY.find((w) => w.id === id)
    const defaultW = Math.min(w?.defaultW ?? 2, cols)
    const x = (i * defaultW) % cols
    const y = Math.floor((i * defaultW) / cols) * (w?.defaultH ?? 2)
    return { i: id, x, y, w: defaultW, h: w?.defaultH ?? 2, minW: w?.minW, minH: w?.minH }
  })
}

interface Props {
  cols: ColCount
}

export function WidgetGrid({ cols }: Props) {
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as GridLayout[]
        setLayouts(parsed as unknown as Layout[])
      } else {
        setLayouts(defaultLayouts(cols))
      }
    } catch {
      setLayouts(defaultLayouts(cols))
    }
    setMounted(true)
  }, [cols])

  const onLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayouts(newLayout)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout))
  }, [])

  if (!mounted) return null

  const colsMap = { lg: cols, md: cols, sm: 2, xs: 1, xxs: 1 }

  return (
    <ResponsiveGrid
      className="react-grid-layout"
      layouts={{ lg: layouts, md: layouts, sm: layouts }}
      cols={colsMap}
      rowHeight={150}
      breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }}
      onLayoutChange={(layout) => onLayoutChange(layout)}
      draggableHandle=".cursor-grab"
      isResizable
      isDraggable
      margin={[8, 8]}
    >
      {layouts.map((layout) => {
        const widget = WIDGET_REGISTRY.find((w) => w.id === layout.i)
        if (!widget) return null
        return (
          <GridItem key={layout.i} title={widget.title}>
            <PlaceholderWidget id={widget.id} title={widget.title} />
          </GridItem>
        )
      })}
    </ResponsiveGrid>
  )
}
