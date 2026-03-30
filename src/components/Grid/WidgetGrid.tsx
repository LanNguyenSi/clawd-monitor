'use client'

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { GridItem } from './GridItem'
import { WIDGET_REGISTRY } from '@/lib/widgets'
import type { ColCount } from '@/types'

// Lazy-load widgets to keep initial bundle small
const WIDGET_COMPONENTS: Record<string, React.LazyExoticComponent<() => React.ReactElement>> = {
  LogTailWidget:       lazy(() => import('@/components/widgets/LogTailWidget').then((m) => ({ default: m.LogTailWidget }))),
  MetricsWidget:       lazy(() => import('@/components/widgets/MetricsWidget').then((m) => ({ default: m.MetricsWidget }))),
  MemoryWidget:        lazy(() => import('@/components/widgets/MemoryWidget').then((m) => ({ default: m.MemoryWidget }))),
  AgentStatusWidget:   lazy(() => import('@/components/widgets/AgentStatusWidget').then((m) => ({ default: m.AgentStatusWidget }))),
  CronWidget:          lazy(() => import('@/components/widgets/CronWidget').then((m) => ({ default: m.CronWidget }))),
  DockerWidget:        lazy(() => import('@/components/widgets/DockerWidget').then((m) => ({ default: m.DockerWidget }))),
  HeartbeatWidget:     lazy(() => import('@/components/widgets/HeartbeatWidget').then((m) => ({ default: m.HeartbeatWidget }))),
  ServiceHealthWidget: lazy(() => import('@/components/widgets/ServiceHealthWidget').then((m) => ({ default: m.ServiceHealthWidget }))),
  GitHubPRWidget:      lazy(() => import('@/components/widgets/GitHubPRWidget').then((m) => ({ default: m.GitHubPRWidget }))),
  AlertHistoryWidget:  lazy(() => import('@/components/widgets/AlertHistoryWidget').then((m) => ({ default: m.AlertHistoryWidget }))),
  AgentListWidget:     lazy(() => import('@/components/widgets/AgentListWidget').then((m) => ({ default: m.AgentListWidget }))),
}

const ResponsiveGrid = WidthProvider(Responsive)

const STORAGE_KEY = 'clawd-monitor:layouts'
const COLS_KEY = 'clawd-monitor:cols'

const DEFAULT_WIDGET_IDS = ['metrics', 'agent-status', 'cron', 'docker']

function defaultLayouts(cols: ColCount): Layout[] {
  return DEFAULT_WIDGET_IDS.map((id, i) => {
    const w = WIDGET_REGISTRY.find((w) => w.id === id)
    const defaultW = Math.min(w?.defaultW ?? 2, cols)
    const x = (i * defaultW) % cols
    const y = Math.floor((i * defaultW) / cols) * (w?.defaultH ?? 2)
    return {
      i: id,
      x,
      y,
      w: defaultW,
      h: w?.defaultH ?? 2,
      minW: w?.minW,
      minH: w?.minH,
    }
  })
}

interface Props {
  cols: ColCount
  editMode?: boolean
  onLayoutChange?: (widgetIds: string[]) => void
}

export function WidgetGrid({ cols, editMode = true, onLayoutChange }: Props) {
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Layout[]
        // Validate that saved layouts contain known widget ids
        const validIds = new Set(WIDGET_REGISTRY.map((w) => w.id))
        const valid = parsed.filter((l) => validIds.has(l.i))
        setLayouts(valid.length > 0 ? valid : defaultLayouts(cols))
      } else {
        setLayouts(defaultLayouts(cols))
      }
    } catch {
      setLayouts(defaultLayouts(cols))
    }
    setMounted(true)
  }, [cols])

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayouts(newLayout)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout))
    onLayoutChange?.(newLayout.map((l) => l.i))
  }, [onLayoutChange])

  if (!mounted) return null

  const colsMap = { lg: cols, md: Math.min(cols, 4), sm: 2, xs: 1, xxs: 1 }

  return (
    <ResponsiveGrid
      className="react-grid-layout"
      layouts={{ lg: layouts, md: layouts, sm: layouts }}
      cols={colsMap}
      rowHeight={150}
      breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }}
      onLayoutChange={(layout) => handleLayoutChange(layout)}
      draggableHandle=".cursor-grab"
      isResizable={editMode}
      isDraggable={editMode}
      margin={[8, 8]}
    >
      {layouts.map((layout) => {
        const widget = WIDGET_REGISTRY.find((w) => w.id === layout.i)
        if (!widget) return null

        const WidgetComp = WIDGET_COMPONENTS[widget.component]

        return (
          <GridItem
            key={layout.i}
            title={widget.title}
            editMode={editMode}
            onRemove={() => {
              const next = layouts.filter((l) => l.i !== layout.i)
              setLayouts(next)
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
            }}
          >
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <span className="text-xs text-zinc-400 dark:text-zinc-700 animate-pulse">Loading…</span>
              </div>
            }>
              {WidgetComp ? <WidgetComp /> : null}
            </Suspense>
          </GridItem>
        )
      })}
    </ResponsiveGrid>
  )
}
