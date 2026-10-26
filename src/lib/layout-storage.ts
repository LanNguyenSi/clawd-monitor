import type { Layout } from 'react-grid-layout'

/** localStorage key holding the persisted dashboard layouts. */
export const LAYOUT_STORAGE_KEY = 'clawd-monitor:layouts'

/** Layouts keyed by react-grid-layout breakpoint name (lg, md, sm, xs, xxs). */
export type ResponsiveLayouts = Record<string, Layout[]>

/** Breakpoint order used to pick the layout that defines which widgets exist. */
const BREAKPOINT_ORDER = ['lg', 'md', 'sm', 'xs', 'xxs']

/** The subset of the Storage interface this module uses. */
export type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AddableWidget {
  id: string
  defaultW: number
  defaultH: number
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function cleanItems(value: unknown, validIds: ReadonlySet<string>): Layout[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Layout[] = []
  for (const item of value) {
    if (!item) continue
    const l = item as Layout
    if (typeof l.i !== 'string' || !validIds.has(l.i) || seen.has(l.i)) continue
    if (!isNum(l.x) || !isNum(l.y) || !isNum(l.w) || !isNum(l.h)) continue
    seen.add(l.i)
    out.push(l)
  }
  return out
}

/**
 * Parses a stored value. Accepts the current format (an object with one
 * layout array per breakpoint) and the legacy format (a single array, which
 * becomes the `lg` layout). Returns null when nothing usable is stored.
 */
export function parseStoredLayouts(
  raw: string | null,
  validIds: ReadonlySet<string>,
): ResponsiveLayouts | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const source: Record<string, unknown> = Array.isArray(parsed)
    ? { lg: parsed }
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  const result: ResponsiveLayouts = {}
  for (const bp of BREAKPOINT_ORDER) {
    const items = cleanItems(source[bp], validIds)
    if (items.length > 0) result[bp] = items
  }
  return Object.keys(result).length > 0 ? result : null
}

/** Reads the stored layouts; null on missing, broken or empty data. */
export function loadLayouts(
  storage: LayoutStorage,
  validIds: ReadonlySet<string>,
): ResponsiveLayouts | null {
  try {
    return parseStoredLayouts(storage.getItem(LAYOUT_STORAGE_KEY), validIds)
  } catch {
    return null
  }
}

/** Writes the layouts in the per-breakpoint format. */
export function saveLayouts(storage: LayoutStorage, layouts: ResponsiveLayouts): void {
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
  } catch {
    // storage full or blocked: the layout just is not persisted
  }
}

/** Drops the stored layouts so the default layout applies again. */
export function resetLayouts(storage: LayoutStorage): void {
  try {
    storage.removeItem(LAYOUT_STORAGE_KEY)
  } catch {
    // nothing to reset when storage is blocked
  }
}

/** Widget ids shown on the dashboard, taken from the widest stored breakpoint. */
export function widgetIdsOf(layouts: ResponsiveLayouts): string[] {
  for (const bp of BREAKPOINT_ORDER) {
    const items = layouts[bp]
    if (items && items.length > 0) return items.map((l) => l.i)
  }
  return []
}

/** Removes a widget from every breakpoint. */
export function removeWidget(layouts: ResponsiveLayouts, id: string): ResponsiveLayouts {
  const result: ResponsiveLayouts = {}
  for (const [bp, items] of Object.entries(layouts)) {
    result[bp] = items.filter((l) => l.i !== id)
  }
  return result
}

/** Appends a widget below the existing ones on every breakpoint (lg when empty). */
export function addWidget(layouts: ResponsiveLayouts, widget: AddableWidget): ResponsiveLayouts {
  const breakpoints = Object.keys(layouts).length > 0 ? Object.keys(layouts) : ['lg']
  const result: ResponsiveLayouts = {}
  for (const bp of breakpoints) {
    const items = layouts[bp] ?? []
    if (items.some((l) => l.i === widget.id)) {
      result[bp] = items
      continue
    }
    const maxY = items.reduce((max, l) => Math.max(max, l.y + l.h), 0)
    result[bp] = [...items, { i: widget.id, x: 0, y: maxY, w: widget.defaultW, h: widget.defaultH }]
  }
  return result
}

/** Adds a widget to the stored layouts (the dashboard "+ Widget" path). */
export function addWidgetToStorage(
  storage: LayoutStorage,
  widget: AddableWidget,
  validIds: ReadonlySet<string>,
): void {
  const current = loadLayouts(storage, validIds) ?? {}
  saveLayouts(storage, addWidget(current, widget))
}
