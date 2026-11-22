'use client'

import { useCallback, useRef, useState } from 'react'
import type { ResponsiveLayouts } from '@/lib/layout-storage'

export interface PendingUndo {
  id: string
  title: string
  /** Every breakpoint's full layout as the user saw it before the remove. */
  before: ResponsiveLayouts
  /** Changes with every notice so the timer and focus restart. */
  key: number
  /**
   * Set by a drag or resize, or by an add that remounted the grid, after the
   * remove: the saved snapshot is then out of date and Undo only splices the
   * widget back in.
   */
  edited: boolean
}

export interface PendingUndoStore {
  pending: PendingUndo | null
  begin: (widget: { id: string; title: string }, before: ResponsiveLayouts) => void
  markEdited: () => void
  clear: () => void
  widgetAdded: (widgetId: string) => void
}

/**
 * The pending widget removal, held above the grid so a remount of the grid
 * (the `r` refresh, Add widget, Reset layout) does not drop it silently.
 */
export function usePendingUndo(): PendingUndoStore {
  const [pending, setPending] = useState<PendingUndo | null>(null)
  const count = useRef(0)

  const begin = useCallback((widget: { id: string; title: string }, before: ResponsiveLayouts) => {
    count.current += 1
    setPending({ id: widget.id, title: widget.title, before, key: count.current, edited: false })
  }, [])

  const markEdited = useCallback(() => {
    setPending((p) => (p && !p.edited ? { ...p, edited: true } : p))
  }, [])

  const clear = useCallback(() => {
    setPending(null)
  }, [])

  const widgetAdded = useCallback((widgetId: string) => {
    setPending((p) => {
      if (!p) return p
      // Adding back the removed widget already is the undo: nothing is left pending.
      if (p.id === widgetId) return null
      // The add remounted the grid and its widget joined the layout: Undo must
      // keep the new widget, so treat the remount as an edit of the layout.
      return { ...p, edited: true }
    })
  }, [])

  return { pending, begin, markEdited, clear, widgetAdded }
}
