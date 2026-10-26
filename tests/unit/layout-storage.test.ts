import { describe, it, expect } from 'vitest'
import {
  LAYOUT_STORAGE_KEY,
  parseStoredLayouts,
  loadLayouts,
  saveLayouts,
  resetLayouts,
  widgetIdsOf,
  removeWidget,
  addWidget,
  addWidgetToStorage,
  defaultLayouts,
  type LayoutStorage,
  type ResponsiveLayouts,
} from '@/lib/layout-storage'

const VALID = new Set(['metrics', 'cron', 'docker', 'log-tail'])

function item(i: string, x = 0, y = 0, w = 2, h = 2) {
  return { i, x, y, w, h }
}

function memoryStorage(initial?: string): LayoutStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(LAYOUT_STORAGE_KEY, initial)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function throwingStorage(): LayoutStorage {
  const boom = () => {
    throw new Error('blocked')
  }
  return { getItem: boom, setItem: boom, removeItem: boom }
}

describe('parseStoredLayouts', () => {
  it('returns null for missing or empty input', () => {
    expect(parseStoredLayouts(null, VALID)).toBeNull()
    expect(parseStoredLayouts('', VALID)).toBeNull()
  })

  it('migrates the legacy single array to the lg breakpoint', () => {
    const legacy = [item('metrics'), item('cron', 2, 0)]
    expect(parseStoredLayouts(JSON.stringify(legacy), VALID)).toEqual({ lg: legacy })
  })

  it('reads the per-breakpoint format and keeps breakpoints apart', () => {
    const stored = { lg: [item('metrics', 0, 0, 2)], sm: [item('metrics', 0, 0, 1)] }
    expect(parseStoredLayouts(JSON.stringify(stored), VALID)).toEqual(stored)
  })

  it('falls back to null on broken JSON', () => {
    expect(parseStoredLayouts('{not json', VALID)).toBeNull()
  })

  it('returns null for JSON that is neither array nor object', () => {
    expect(parseStoredLayouts('42', VALID)).toBeNull()
    expect(parseStoredLayouts('null', VALID)).toBeNull()
  })

  it('drops unknown ids, duplicates and malformed entries', () => {
    const raw = JSON.stringify({
      lg: [
        item('metrics'),
        item('metrics', 4, 4),
        item('nope'),
        null,
        'x',
        { i: 'cron', x: 'a', y: 0, w: 1, h: 1 },
        { i: 5, x: 0, y: 0, w: 1, h: 1 },
      ],
      md: 'not an array',
    })
    expect(parseStoredLayouts(raw, VALID)).toEqual({ lg: [item('metrics')] })
  })

  it('requires finite numbers for every coordinate', () => {
    const bad = [
      { i: 'metrics', x: 0, y: 'a', w: 1, h: 1 },
      { i: 'cron', x: 0, y: 0, w: null, h: 1 },
      { i: 'docker', x: 0, y: 0, w: 1, h: Number.NaN },
      { i: 'log-tail', x: Infinity, y: 0, w: 1, h: 1 },
    ]
    expect(parseStoredLayouts(JSON.stringify([...bad, item('metrics')]), VALID)).toEqual({
      lg: [item('metrics')],
    })
  })

  it('returns null when no valid item survives', () => {
    expect(parseStoredLayouts(JSON.stringify([item('nope')]), VALID)).toBeNull()
    expect(parseStoredLayouts('{}', VALID)).toBeNull()
  })
})

describe('loadLayouts / saveLayouts / resetLayouts', () => {
  it('round-trips the per-breakpoint format', () => {
    const s = memoryStorage()
    const layouts: ResponsiveLayouts = { lg: [item('metrics')], sm: [item('metrics', 0, 0, 1)] }
    saveLayouts(s, layouts)
    expect(JSON.parse(s.data.get(LAYOUT_STORAGE_KEY)!)).toEqual(layouts)
    expect(loadLayouts(s, VALID)).toEqual(layouts)
  })

  it('loads null from empty storage', () => {
    expect(loadLayouts(memoryStorage(), VALID)).toBeNull()
  })

  it('loads null from corrupt storage', () => {
    expect(loadLayouts(memoryStorage('][broken'), VALID)).toBeNull()
  })

  it('does not throw when storage access is blocked', () => {
    const s = throwingStorage()
    expect(loadLayouts(s, VALID)).toBeNull()
    expect(() => saveLayouts(s, { lg: [] })).not.toThrow()
    expect(() => resetLayouts(s)).not.toThrow()
  })

  it('reset removes the stored layouts', () => {
    const s = memoryStorage(JSON.stringify([item('metrics')]))
    resetLayouts(s)
    expect(s.data.has(LAYOUT_STORAGE_KEY)).toBe(false)
    expect(loadLayouts(s, VALID)).toBeNull()
  })

  it('a narrow-viewport save leaves the stored lg layout untouched', () => {
    const lg = [item('metrics', 0, 0, 2), item('cron', 2, 0, 2)]
    const s = memoryStorage(JSON.stringify({ lg }))
    const loaded = loadLayouts(s, VALID)!
    // what react-grid-layout reports at 390px: only the sm/xs entries change
    saveLayouts(s, { ...loaded, xxs: [item('metrics', 0, 0, 1), item('cron', 0, 2, 1)] })
    const again = loadLayouts(s, VALID)!
    expect(again.lg).toEqual(lg)
    expect(again.xxs).toHaveLength(2)
  })
})

describe('widgetIdsOf', () => {
  it('uses the widest breakpoint that has items', () => {
    expect(widgetIdsOf({ lg: [item('metrics')], sm: [item('cron')] })).toEqual(['metrics'])
    expect(widgetIdsOf({ lg: [], sm: [item('cron')] })).toEqual(['cron'])
  })

  it('is empty without layouts', () => {
    expect(widgetIdsOf({})).toEqual([])
  })
})

describe('removeWidget', () => {
  it('removes the widget from every breakpoint', () => {
    const out = removeWidget(
      { lg: [item('metrics'), item('cron')], sm: [item('metrics'), item('cron')] },
      'metrics',
    )
    expect(out).toEqual({ lg: [item('cron')], sm: [item('cron')] })
  })
})

describe('addWidget / addWidgetToStorage', () => {
  const widget = { id: 'log-tail', defaultW: 2, defaultH: 3 }
  const FALLBACK: ResponsiveLayouts = { lg: [item('metrics', 0, 0, 1, 2), item('cron', 1, 0, 2, 2)] }

  it('appends below existing items on every stored breakpoint', () => {
    const out = addWidget({ lg: [item('metrics', 0, 0, 1, 2)], sm: [item('metrics', 0, 0, 1, 4)] }, widget)
    expect(out.lg[1]).toEqual({ i: 'log-tail', x: 0, y: 2, w: 2, h: 3 })
    expect(out.sm[1]).toEqual({ i: 'log-tail', x: 0, y: 4, w: 2, h: 3 })
  })

  it('starts the lg layout when nothing is stored', () => {
    expect(addWidget({}, widget)).toEqual({ lg: [{ i: 'log-tail', x: 0, y: 0, w: 2, h: 3 }] })
  })

  it('does not add a widget twice', () => {
    const base = { lg: [item('log-tail')] }
    expect(addWidget(base, widget)).toEqual(base)
  })

  it('writes the per-breakpoint format, not the legacy array', () => {
    const s = memoryStorage()
    addWidgetToStorage(s, widget, VALID, FALLBACK)
    const stored = JSON.parse(s.data.get(LAYOUT_STORAGE_KEY)!)
    expect(Array.isArray(stored)).toBe(false)
    expect(stored.lg).toEqual([...FALLBACK.lg, { i: 'log-tail', x: 0, y: 2, w: 2, h: 3 }])
  })

  it('migrates a legacy array while adding', () => {
    const s = memoryStorage(JSON.stringify([item('metrics', 0, 0, 1, 2)]))
    addWidgetToStorage(s, widget, VALID, FALLBACK)
    const stored = JSON.parse(s.data.get(LAYOUT_STORAGE_KEY)!)
    expect(stored.lg.map((l: { i: string }) => l.i)).toEqual(['metrics', 'log-tail'])
  })

  it('keeps the shown layout when the stored value is corrupt', () => {
    const s = memoryStorage('][broken')
    addWidgetToStorage(s, widget, VALID, FALLBACK)
    expect(JSON.parse(s.data.get(LAYOUT_STORAGE_KEY)!).lg).toHaveLength(3)
  })

  it('prefers the stored layout over the fallback', () => {
    const s = memoryStorage(JSON.stringify({ lg: [item('docker')] }))
    addWidgetToStorage(s, widget, VALID, FALLBACK)
    expect(JSON.parse(s.data.get(LAYOUT_STORAGE_KEY)!).lg.map((l: { i: string }) => l.i)).toEqual(['docker', 'log-tail'])
  })
})

describe('defaultLayouts', () => {
  it('places the four default widgets on lg within the column count', () => {
    for (const cols of [2, 4, 8] as const) {
      const { lg } = defaultLayouts(cols)
      expect(lg.map((l) => l.i)).toEqual(['metrics', 'agent-status', 'cron', 'docker'])
      for (const l of lg) {
        expect(l.w).toBeLessThanOrEqual(cols)
        expect(l.x + l.w).toBeLessThanOrEqual(cols)
      }
    }
  })

  it('caps the widget width at the column count', () => {
    expect(defaultLayouts(2).lg.find((l) => l.i === 'cron')!.w).toBe(2)
    expect(defaultLayouts(8).lg.find((l) => l.i === 'cron')!.w).toBe(2)
  })
})
