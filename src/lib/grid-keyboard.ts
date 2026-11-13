import type { Layout } from 'react-grid-layout'
// The layout helpers are imported from react-grid-layout's build directory:
// the package's main entry exposes them only as an untyped `utils` property, so
// the deep paths are the ones TypeScript can be given declarations for (see
// react-grid-layout-utils.d.ts). Verified against react-grid-layout 1.5.4, where
// index.js re-exports these same modules; recheck the paths on an upgrade.
import { cloneLayout, compact, getLayoutItem, moveElement } from 'react-grid-layout/build/utils'
import { findOrGenerateResponsiveLayout, getBreakpointFromWidth } from 'react-grid-layout/build/responsiveUtils'

/** Breakpoint name to minimum container width, as the dashboard grid uses it. */
export const GRID_BREAKPOINTS: Record<string, number> = { lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }

/** Columns per breakpoint for a base column count (the lg column count). */
export function gridColsFor(cols: number): Record<string, number> {
  return { lg: cols, md: Math.min(cols, 4), sm: 2, xs: 1, xxs: 1 }
}

/**
 * The breakpoint the grid shows at a measured container width. A width of 0
 * means "not measured" and counts as lg, the width react-grid-layout's
 * WidthProvider assumes before it measures.
 */
export function breakpointAtWidth(width: number): string {
  return getBreakpointFromWidth(GRID_BREAKPOINTS, width > 0 ? width : 1280)
}

/**
 * The layout the grid shows for a breakpoint: the stored one, or the one
 * react-grid-layout generates from the nearest other breakpoint when there is none.
 */
export function layoutAtBreakpoint(layouts: Record<string, Layout[]>, bp: string, cols: number): Layout[] {
  return findOrGenerateResponsiveLayout(layouts, GRID_BREAKPOINTS, bp, bp, cols, 'vertical')
}

/** Keys the focused widget card reacts to: Arrow moves, Shift+Arrow resizes. */
export const GRID_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const
export type GridKey = (typeof GRID_KEYS)[number]

export function isGridKey(key: string): key is GridKey {
  return (GRID_KEYS as readonly string[]).includes(key)
}

export interface GridKeyResult {
  /** The layout after the key; the input layout itself when nothing changed. */
  layout: Layout[]
  changed: boolean
  /** Text for a polite live region. */
  message: string
}

const DIRECTION: Record<GridKey, { dx: number; dy: number; word: string; edge: string }> = {
  ArrowLeft: { dx: -1, dy: 0, word: 'left', edge: 'left edge' },
  ArrowRight: { dx: 1, dy: 0, word: 'right', edge: 'right edge' },
  ArrowUp: { dx: 0, dy: -1, word: 'up', edge: 'top' },
  ArrowDown: { dx: 0, dy: 1, word: 'down', edge: 'bottom' },
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Applies one arrow key to a widget the way react-grid-layout applies a pointer
 * move or resize: a move goes through `moveElement` (colliding widgets are
 * pushed away) and a resize is clamped to the item's minW/maxW/minH/maxH and
 * to the columns that are left right of it; the result is compacted vertically
 * like the grid's own layout. Pure: `layout` is not modified.
 *
 * A move is one cell. Only when one cell changes nothing (compaction pulls the
 * widget straight back, e.g. one row down against a taller widget below) the
 * step grows to the smallest one that does change the layout, so the key never
 * leaves a widget stuck in the middle of the grid.
 */
export function applyGridKey(
  layout: Layout[],
  id: string,
  key: GridKey,
  resize: boolean,
  cols: number,
  title: string,
  titleOf: (id: string) => string = (other) => other,
): GridKeyResult {
  const start = getLayoutItem(layout, id)
  if (!start) return { layout, changed: false, message: '' }
  const { dx, dy, word, edge } = DIRECTION[key]
  const before = { x: start.x, y: start.y, w: start.w, h: start.h }
  const same = (l: Layout) => l.x === before.x && l.y === before.y && l.w === before.w && l.h === before.h

  let result: { layout: Layout[]; item: Layout; step: number; target: { x: number; y: number } } | null = null
  if (resize) {
    const work = cloneLayout(layout)
    const item = getLayoutItem(work, id) as Layout
    const w = clamp(item.w + dx, item.minW ?? 1, Math.min(item.maxW ?? Infinity, cols - item.x))
    const h = clamp(item.h + dy, item.minH ?? 1, item.maxH ?? Infinity)
    item.w = Math.max(w, 1)
    item.h = Math.max(h, 1)
    const next = compact(work, 'vertical', cols)
    result = { layout: next, item: getLayoutItem(next, id) as Layout, step: 1, target: { x: before.x, y: before.y } }
  } else {
    // No move can need more steps than the grid has columns and rows.
    const rows = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0)
    const limit = dx !== 0 ? cols : rows + before.h
    let lastTarget = ''
    for (let step = 1; step <= limit; step++) {
      const x = clamp(before.x + dx * step, 0, Math.max(cols - before.w, 0))
      const y = Math.max(before.y + dy * step, 0)
      if (`${x},${y}` === lastTarget) break
      lastTarget = `${x},${y}`
      const work = cloneLayout(layout)
      const item = getLayoutItem(work, id) as Layout
      const next = compact(moveElement(work, item, x, y, true, false, 'vertical', cols, false), 'vertical', cols)
      const after = getLayoutItem(next, id) as Layout
      if (!same(after)) {
        result = { layout: next, item: after, step, target: { x, y } }
        break
      }
    }
  }

  if (!result || same(result.item)) {
    return {
      layout,
      changed: false,
      message: resize ? `${title}: size limit reached` : `${title}: cannot move ${word}, already at the ${edge}`,
    }
  }
  const after = result.item
  const where = `column ${after.x + 1}, row ${after.y + 1}`
  let message: string
  if (resize) {
    message = `${title} resized to ${after.w} by ${after.h}`
  } else {
    const passed = result.step > 1 ? widgetPassed(layout, result.layout, start, key, result.target, after) : null
    message = passed ? `${title} moved ${passed.relation} ${titleOf(passed.id)}, ${where}` : `${title} moved to ${where}`
  }
  return { layout: result.layout, changed: true, message }
}

const overlaps = (a: Layout, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * The widget a grown step went past: one that sat where the widget landed
 * before the move and is now wholly on the side it came from. Only vertical
 * steps can grow (compaction undoes nothing sideways). Null when no
 * widget qualifies, so the message never claims more than the layout shows.
 */
export function widgetPassed(
  before: Layout[],
  after: Layout[],
  start: Layout,
  key: GridKey,
  target: { x: number; y: number },
  moved: Layout,
): { id: string; relation: string } | null {
  const box = { x: target.x, y: target.y, w: start.w, h: start.h }
  const candidates = before
    .filter((l) => l.i !== start.i && overlaps(l, box))
    .map((l) => getLayoutItem(after, l.i))
    .filter((l): l is Layout => Boolean(l))
  // The overlapped widgets in layout order: the first that ended up wholly on the
  // side the mover came from is the one it passed.
  for (const l of candidates) {
    if (key === 'ArrowDown' && l.y + l.h <= moved.y) return { id: l.i, relation: 'below' }
    if (key === 'ArrowUp' && l.y >= moved.y + moved.h) return { id: l.i, relation: 'above' }
  }
  return null
}
