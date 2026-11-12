// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

const grid = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))

vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  return {
    WidthProvider: (c: unknown) => c,
    Responsive: (props: { children: React.ReactNode }) => {
      grid.props = props as unknown as Record<string, unknown>
      return React.createElement('div', { 'data-testid': 'grid' }, props.children)
    },
  }
})
vi.mock('@/components/widgets/MetricsWidget', () => ({ MetricsWidget: () => null }))
vi.mock('@/components/widgets/CronWidget', () => ({ CronWidget: () => null }))

import { WidgetGrid } from '@/components/Grid/WidgetGrid'
import { UNDO_NOTICE_MS } from '@/components/Grid/UndoNotice'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SAVED = {
  lg: [
    { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
    { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
  ],
  xxs: [
    { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
    { i: 'cron', x: 0, y: 2, w: 1, h: 2 },
  ],
}

let host: HTMLDivElement
let root: Root

async function mountGrid(editMode?: boolean) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(editMode === undefined ? <WidgetGrid cols={4} /> : <WidgetGrid cols={4} editMode={editMode} />)
  })
  await act(async () => {})
}

const removeButton = (title: string) =>
  host.ownerDocument.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${title} widget"]`)
const stored = () => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) as string)
const notice = () => host.ownerDocument.querySelector('[role="status"]')
const undoButton = () =>
  Array.from(host.ownerDocument.querySelectorAll('button')).find((b) => b.textContent === 'Undo')
const headings = () => Array.from(host.querySelectorAll('h2')).map((h) => h.textContent)

beforeEach(() => {
  grid.props = null
  localStorage.clear()
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(SAVED))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('WidgetGrid lock mode', () => {
  it('is locked by default: no remove buttons, not draggable, not resizable', async () => {
    await mountGrid()
    expect(headings()).toEqual(['CPU + RAM', 'Cron Jobs'])
    expect(removeButton('CPU + RAM')).toBeNull()
    expect(removeButton('Cron Jobs')).toBeNull()
    expect(grid.props?.isDraggable).toBe(false)
    expect(grid.props?.isResizable).toBe(false)
  })

  it('shows remove buttons and allows dragging in edit mode', async () => {
    await mountGrid(true)
    expect(removeButton('CPU + RAM')).not.toBeNull()
    expect(removeButton('Cron Jobs')).not.toBeNull()
    expect(grid.props?.isDraggable).toBe(true)
  })

  it('switches from locked to editable when the prop changes', async () => {
    await mountGrid(false)
    expect(removeButton('CPU + RAM')).toBeNull()
    await act(async () => {
      root.render(<WidgetGrid cols={4} editMode />)
    })
    expect(removeButton('CPU + RAM')).not.toBeNull()
  })
})

describe('WidgetGrid undo after remove', () => {
  it('removes a widget, offers Undo, and restores widget and stored layout', async () => {
    await mountGrid(true)
    await act(async () => removeButton('CPU + RAM')!.click())
    expect(headings()).toEqual(['Cron Jobs'])
    expect(stored().lg.map((l: { i: string }) => l.i)).toEqual(['cron'])
    expect(stored().xxs.map((l: { i: string }) => l.i)).toEqual(['cron'])
    const n = notice()
    expect(n).not.toBeNull()
    expect(n?.getAttribute('aria-live')).toBe('polite')
    expect(n?.textContent).toContain('CPU + RAM removed')

    await act(async () => undoButton()!.click())
    expect(notice()).toBeNull()
    expect(headings().sort()).toEqual(['CPU + RAM', 'Cron Jobs'])
    const after = stored()
    expect(after.lg.find((l: { i: string }) => l.i === 'metrics')).toEqual(SAVED.lg[0])
    expect(after.xxs.find((l: { i: string }) => l.i === 'metrics')).toEqual(SAVED.xxs[0])
    expect(after.lg).toHaveLength(2)
  })

  it('restores a removed widget exactly once', async () => {
    await mountGrid(true)
    await act(async () => removeButton('Cron Jobs')!.click())
    await act(async () => undoButton()!.click())
    expect(stored().lg.filter((l: { i: string }) => l.i === 'cron')).toHaveLength(1)
  })

  it('expires after the timeout and then cannot be undone', async () => {
    vi.useFakeTimers()
    await mountGrid(true)
    await act(async () => removeButton('CPU + RAM')!.click())
    expect(notice()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(UNDO_NOTICE_MS - 1)
    })
    expect(notice()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(2)
    })
    expect(notice()).toBeNull()
    expect(stored().lg.map((l: { i: string }) => l.i)).toEqual(['cron'])
  })

  it('dismisses on Escape without restoring', async () => {
    await mountGrid(true)
    await act(async () => removeButton('CPU + RAM')!.click())
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(notice()).toBeNull()
    expect(headings()).toEqual(['Cron Jobs'])
  })

  it('keeps only the latest removal undoable', async () => {
    await mountGrid(true)
    await act(async () => removeButton('CPU + RAM')!.click())
    await act(async () => removeButton('Cron Jobs')!.click())
    expect(notice()?.textContent).toContain('Cron Jobs removed')
    await act(async () => undoButton()!.click())
    expect(headings()).toEqual(['Cron Jobs'])
  })
})
