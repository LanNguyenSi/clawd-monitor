// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

const grid = vi.hoisted(() => ({ props: null as null | Record<string, (...a: unknown[]) => void> }))

// Real react-grid-layout (its compaction decides where widgets land); only the
// width measurement is replaced and the props are recorded so a test can
// simulate a drag.
vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  const actual = await vi.importActual<typeof import('react-grid-layout')>('react-grid-layout')
  const Real = actual.Responsive as unknown as React.ComponentType<Record<string, unknown>>
  return {
    ...actual,
    WidthProvider: (C: React.ComponentType<Record<string, unknown>>) =>
      function Fixed(p: Record<string, unknown>) {
        return React.createElement(C, { ...p, width: 1280 })
      },
    Responsive: function Recording(p: Record<string, unknown>) {
      grid.props = p as unknown as typeof grid.props
      return React.createElement(Real, p)
    },
  }
})
vi.mock('@/components/widgets/MetricsWidget', () => ({ MetricsWidget: () => null }))
vi.mock('@/components/widgets/CronWidget', () => ({ CronWidget: () => null }))
vi.mock('@/components/widgets/HeartbeatWidget', () => ({ HeartbeatWidget: () => null }))
vi.mock('@/components/widgets/AlertHistoryWidget', () => ({ AlertHistoryWidget: () => null }))

import { WidgetGrid } from '@/components/Grid/WidgetGrid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Item = { i: string; x: number; y: number; w: number; h: number }

let root: Root
let host: HTMLDivElement

async function mount(lg: Item[]) {
  localStorage.clear()
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ lg }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<WidgetGrid cols={4} editMode />))
  await act(async () => {})
}

const stored = (): Item[] => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).lg
const pos = () => Object.fromEntries(stored().map((l) => [l.i, [l.x, l.y]]))
const remove = async (title: string) => {
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${title} widget"]`)!.click())
  await act(async () => {})
}
const undo = async () => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === 'Undo')!
  await act(async () => b.click())
  await act(async () => {})
}

beforeEach(() => {
  grid.props = null
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('Undo with the real grid', () => {
  it('restores a tie layout: the widget below the removed one moved up', async () => {
    await mount([
      { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
      { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
      { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 },
    ])
    await remove('CPU + RAM')
    expect(pos().heartbeat).toEqual([0, 0])
    await undo()
    expect(pos()).toEqual({ metrics: [0, 0], cron: [1, 0], heartbeat: [0, 2] })
  })

  it('restores a staggered layout with mixed heights', async () => {
    await mount([
      { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alert-history', x: 0, y: 4, w: 1, h: 2 },
    ])
    const before = pos()
    await remove('CPU + RAM')
    await undo()
    expect(pos()).toEqual(before)
    expect(stored()).toHaveLength(4)
  })

  it('splices the widget back and keeps the new layout when something was dragged in between', async () => {
    await mount([
      { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alert-history', x: 0, y: 4, w: 1, h: 2 },
    ])
    await remove('CPU + RAM')
    // Simulate dragging heartbeat to the right edge.
    const old = stored().find((l) => l.i === 'heartbeat')
    const moved = stored().map((l) => (l.i === 'heartbeat' ? { ...l, x: 3 } : l))
    await act(async () => {
      grid.props!.onLayoutChange(moved, { lg: moved })
      grid.props!.onDragStop(moved, old, moved.find((l) => l.i === 'heartbeat'))
    })
    await act(async () => {})
    expect(pos().heartbeat).toEqual([3, 0])
    await undo()
    expect(pos().heartbeat).toEqual([3, 0])
    expect(stored().map((l) => l.i).sort()).toEqual(['alert-history', 'cron', 'heartbeat', 'metrics'])
    expect(stored().filter((l) => l.i === 'metrics')).toHaveLength(1)
  })

  it('treats a resize in between like a drag', async () => {
    await mount([
      { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alert-history', x: 0, y: 4, w: 1, h: 2 },
    ])
    await remove('CPU + RAM')
    const old = stored().find((l) => l.i === 'cron')
    const resized = stored().map((l) => (l.i === 'cron' ? { ...l, w: 2 } : l))
    await act(async () => {
      grid.props!.onLayoutChange(resized, { lg: resized })
      grid.props!.onResizeStop(resized, old, resized.find((l) => l.i === 'cron'))
    })
    await act(async () => {})
    await undo()
    expect(stored().find((l) => l.i === 'cron')?.w).toBe(2)
    expect(stored().filter((l) => l.i === 'metrics')).toHaveLength(1)
  })

  it('a click on a drag handle without movement keeps the snapshot restore', async () => {
    await mount([
      { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alert-history', x: 0, y: 4, w: 1, h: 2 },
    ])
    const before = pos()
    await remove('CPU + RAM')
    const now = stored()
    const hb = now.find((l) => l.i === 'heartbeat')!
    await act(async () => {
      grid.props!.onDragStop(now, hb, { ...hb })
    })
    await undo()
    expect(pos()).toEqual(before)
  })

  it('does not bring back a widget that is no longer in the layout at Undo time', async () => {
    await mount([
      { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
      { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
      { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      { i: 'alert-history', x: 0, y: 4, w: 1, h: 2 },
    ])
    await remove('CPU + RAM')
    const withoutCron = stored().filter((l) => l.i !== 'cron')
    await act(async () => {
      grid.props!.onLayoutChange(withoutCron, { lg: withoutCron })
    })
    await act(async () => {})
    await undo()
    const ids = stored().map((l) => l.i)
    expect(ids).not.toContain('cron')
    expect(ids.filter((i) => i === 'metrics')).toHaveLength(1)
  })
})
