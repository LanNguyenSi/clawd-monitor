'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useId, useRef, lazy, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { GridItem } from './GridItem'
import { UndoNotice } from './UndoNotice'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import {
  applyGridKey,
  breakpointAtWidth,
  GRID_BREAKPOINTS,
  gridColsFor,
  isGridKey,
  layoutAtBreakpoint,
} from '@/lib/grid-keyboard'
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

interface RemovedWidget {
  id: string
  title: string
  /** Every breakpoint's full layout as the user saw it before the remove. */
  before: ResponsiveLayouts
  key: number
}

type PendingFocus = { kind: 'widget'; title: string } | { kind: 'grid' }

const CARD_KEYS_HINT =
  'Arrow keys move this widget by one cell. Shift plus an arrow key resizes it by one cell. Escape leaves the widget.'

/** Longest wait for a layout transition to end before the card is scrolled into view anyway. */
const SCROLL_FALLBACK_MS = 400

const titleOfWidget = (id: string) => WIDGET_REGISTRY.find((w) => w.id === id)?.title ?? id

export function WidgetGrid({ cols, editMode = false, onLayoutChange }: Props) {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>({})
  const [mounted, setMounted] = useState(false)
  const [removed, setRemoved] = useState<RemovedWidget | null>(null)
  const removalCount = useRef(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  // Set by a drag or resize after the remove: the saved snapshot is then out of
  // date and Undo only splices the widget back in.
  const editedSinceRemove = useRef(false)
  const [announcement, setAnnouncement] = useState<{ n: number; text: string }>({ n: 0, text: '' })
  const lastMessage = useRef('')
  const cancelScroll = useRef<(() => void) | null>(null)
  // True while focus is, or just was, inside the grid; see the edit-mode effect.
  const focusInGrid = useRef(false)
  const wasEditMode = useRef(editMode)
  const hintId = useId()

  const announce = useCallback((text: string) => {
    lastMessage.current = text
    setAnnouncement((a) => ({ n: a.n + 1, text }))
  }, [])

  // Locking the layout removes the focused card's tab stop, and the browser
  // then drops focus to <body>. Put it on the grid container instead: it keeps
  // the keyboard user's place in the page (Tab goes on into the grid, Shift+Tab
  // back to the toolbar) and, unlike the "Edit layout" toggle, does not move
  // them away from what they were working on.
  useLayoutEffect(() => {
    const was = wasEditMode.current
    wasEditMode.current = editMode
    if (!was || editMode) return
    const root = gridRef.current
    const active = document.activeElement
    const inGrid = Boolean(root && active && root.contains(active))
    // Some browsers have already moved focus to <body> when the effect runs.
    if (inGrid || (active === document.body && focusInGrid.current)) {
      root?.focus({ preventScroll: true })
      announce('Layout locked')
    }
  }, [editMode, announce])

  useEffect(() => () => cancelScroll.current?.(), [])

  // Move focus once the DOM reflects the state change that asked for it.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const root = gridRef.current
    if (!root) return
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]'))
    const button = target.kind === 'widget'
      ? buttons.find((b) => b.getAttribute('aria-label') === `Remove ${target.title} widget`)
      : buttons[0]
    if (target.kind === 'widget' && button) button.focus()
    else (button ?? root).focus({ preventScroll: true })
  })

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

  const dismissRemoved = useCallback((reason: 'escape' | 'expired') => {
    // Escape with focus inside the notice would drop focus to the page: hand it
    // to the first widget's remove button. Expiry never touches focus.
    if (reason === 'escape' && document.activeElement?.closest('[data-undo-notice]')) {
      pendingFocus.current = { kind: 'grid' }
    }
    setRemoved(null)
  }, [])

  // react-grid-layout calls onDragStop on every mouseup on a drag handle, also
  // for a plain click without movement; only a real move or resize counts.
  const markEdited = useCallback((_layout: Layout[], oldItem?: Layout, newItem?: Layout) => {
    if (!oldItem || !newItem) return
    if (oldItem.x !== newItem.x || oldItem.y !== newItem.y || oldItem.w !== newItem.w || oldItem.h !== newItem.h) {
      editedSinceRemove.current = true
    }
  }, [])

  // The grid slides a moved card with a CSS transition. Scroll once it has
  // arrived (or after a fallback delay when no transition runs), because
  // moving it with the arrow keys can put it far outside the visible area and
  // the arrows are not available for scrolling.
  const scrollIntoViewWhenSettled = (card: HTMLElement) => {
    cancelScroll.current?.()
    const run = () => {
      cancel()
      card.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
    const onEnd = (event: Event) => {
      if (event.target === card) run()
    }
    const cancel = () => {
      clearTimeout(timer)
      card.removeEventListener('transitionend', onEnd)
      cancelScroll.current = null
    }
    card.addEventListener('transitionend', onEnd)
    const timer = setTimeout(run, SCROLL_FALLBACK_MS)
    cancelScroll.current = cancel
  }

  const handleCardKey = (id: string, title: string, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Leave the widget; the grid container keeps the place in the tab order.
      // preventDefault: this Escape is spent, it must not also dismiss an Undo notice.
      e.preventDefault()
      gridRef.current?.focus({ preventScroll: true })
      return
    }
    if (!isGridKey(e.key) || e.ctrlKey || e.altKey || e.metaKey) return
    e.preventDefault()
    // Start from what the grid shows: the layout of the breakpoint the
    // container width falls in, measured the way WidthProvider measures it.
    const gridEl = gridRef.current?.querySelector<HTMLElement>('.react-grid-layout')
    const bp = breakpointAtWidth(gridEl?.offsetWidth ?? 0)
    const bpCols = gridColsFor(cols)[bp]
    const card = e.currentTarget
    const result = applyGridKey(layoutAtBreakpoint(layouts, bp, bpCols), id, e.key, e.shiftKey, bpCols, title, titleOfWidget)
    // A held key repeats: do not read out the same refusal again and again.
    if (!(e.repeat && result.message === lastMessage.current)) announce(result.message)
    if (!result.changed) return
    // Same path as a pointer move: persist per breakpoint and report the ids.
    editedSinceRemove.current = true
    handleLayoutChange(result.layout, { ...layouts, [bp]: result.layout })
    scrollIntoViewWhenSettled(card)
  }

  const handleRemove = (id: string, title: string) => {
    const next = removeWidget(layouts, id)
    setLayouts(next)
    saveLayouts(localStorage, next)
    onLayoutChange?.(widgetIdsOf(next))
    removalCount.current += 1
    editedSinceRemove.current = false
    setRemoved({ id, title, before: layouts, key: removalCount.current })
  }

  const handleUndo = () => {
    if (!removed) return
    const next: ResponsiveLayouts = { ...layouts }
    for (const [bp, snapshot] of Object.entries(removed.before)) {
      const current = next[bp]
      if (!current) continue
      if (!editedSinceRemove.current) {
        // Nothing moved since the remove: put the layout back exactly as it was
        // (keeping only widgets that still exist).
        const present = new Set(current.map((l) => l.i))
        next[bp] = snapshot.filter((l) => l.i === removed.id || present.has(l.i))
        continue
      }
      // The user dragged or resized meanwhile: keep their layout and splice the
      // widget back at its old list index.
      const index = snapshot.findIndex((l) => l.i === removed.id)
      if (index < 0 || current.some((l) => l.i === removed.id)) continue
      const list = [...current]
      list.splice(Math.min(index, list.length), 0, snapshot[index])
      next[bp] = list
    }
    pendingFocus.current = { kind: 'widget', title: removed.title }
    setLayouts(next)
    saveLayouts(localStorage, next)
    onLayoutChange?.(widgetIdsOf(next))
    setRemoved(null)
  }

  if (!mounted) return null

  const colsMap = gridColsFor(cols)

  return (
    <div
      ref={gridRef}
      tabIndex={-1}
      className="outline-none"
      onFocus={() => { focusInGrid.current = true }}
      onBlur={(e) => {
        // Focus moving to another element outside the grid ends "inside"; a blur
        // to nowhere (relatedTarget null) may be the browser's own focus fix-up.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) focusInGrid.current = false
      }}
    >
    <ResponsiveGrid
      className="react-grid-layout"
      layouts={layouts}
      cols={colsMap}
      rowHeight={150}
      breakpoints={GRID_BREAKPOINTS}
      onDragStop={markEdited}
      onResizeStop={markEdited}
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
            descriptionId={editMode ? hintId : undefined}
            onCardKeyDown={(e) => handleCardKey(id, widget.title, e)}
            onRemove={() => handleRemove(id, widget.title)}
          >
            <ErrorBoundary>
              <Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 animate-pulse">Loading…</span>
                </div>
              }>
                {WidgetComp ? <WidgetComp /> : null}
              </Suspense>
            </ErrorBoundary>
          </GridItem>
        )
      })}
    </ResponsiveGrid>
    {/* One description for every card (aria-describedby works on hidden elements). */}
    {editMode && <span id={hintId} hidden>{CARD_KEYS_HINT}</span>}
    {/* Polite live region for keyboard moves; the span is re-created per message so a repeated text is announced again. */}
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-grid-announcer="">
      <span key={announcement.n}>{announcement.text}</span>
    </div>
    <UndoNotice
      notice={removed ? { key: removed.key, message: `${removed.title} removed` } : null}
      onUndo={handleUndo}
      onDismiss={dismissRemoved}
    />
    </div>
  )
}
