'use client'

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { GridItem } from './GridItem'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { WIDGET_REGISTRY } from '@/lib/widgets'
import {
  defaultLayouts,
  loadLayouts,
  saveLayouts,
  widgetIdsOf,
  removeWidget,
  type ResponsiveLayouts,
} from '@/lib/layout-storage'
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
  SessionLogWidget:    lazy(() => import('@/components/widgets/SessionLogWidget').then((m) => ({ default: m.SessionLogWidget }))),
}

const ResponsiveGrid = WidthProvider(Responsive)

const COLS_KEY = 'clawd-monitor:cols'

interface Props {
  cols: ColCount
  editMode?: boolean
  onLayoutChange?: (widgetIds: string[]) => void
}

export function WidgetGrid({ cols, editMode = true, onLayoutChange }: Props) {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>({})
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const validIds = new Set(WIDGET_REGISTRY.map((w) => w.id))
    setLayouts(loadLayouts(localStorage, validIds) ?? defaultLayouts(cols))
    setMounted(true)
  }, [cols])

  const handleLayoutChange = useCallback((current: Layout[], all: ResponsiveLayouts) => {
    // Keep every breakpoint's layout separate: a narrow viewport only changes
    // its own entry and never overwrites the desktop layout.
    setLayouts(all)
    saveLayouts(localStorage, all)
    onLayoutChange?.(current.map((l) => l.i))
  }, [onLayoutChange])

  if (!mounted) return null

  const colsMap = { lg: cols, md: Math.min(cols, 4), sm: 2, xs: 1, xxs: 1 }

  return (
    <ResponsiveGrid
      className="react-grid-layout"
      layouts={layouts}
      cols={colsMap}
      rowHeight={150}
      breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }}
      onLayoutChange={(current, all) => handleLayoutChange(current, all as ResponsiveLayouts)}
      draggableHandle=".cursor-grab"
      isResizable={editMode}
      isDraggable={editMode}
      margin={[8, 8]}
    >
      {widgetIdsOf(layouts).map((id) => {
        const widget = WIDGET_REGISTRY.find((w) => w.id === id)
        if (!widget) return null

        const WidgetComp = WIDGET_COMPONENTS[widget.component]

        return (
          <GridItem
            key={id}
            title={widget.title}
            editMode={editMode}
            onRemove={() => {
              const next = removeWidget(layouts, id)
              setLayouts(next)
              saveLayouts(localStorage, next)
              onLayoutChange?.(widgetIdsOf(next))
            }}
          >
            <ErrorBoundary>
              <Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-zinc-400 dark:text-zinc-700 animate-pulse">Loading…</span>
                </div>
              }>
                {WidgetComp ? <WidgetComp /> : null}
              </Suspense>
            </ErrorBoundary>
          </GridItem>
        )
      })}
    </ResponsiveGrid>
  )
}
