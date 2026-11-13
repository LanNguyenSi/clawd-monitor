// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

// Real react-grid-layout (its compaction decides where widgets land); only the
// width measurement is replaced: 1280 px is the lg breakpoint.
let gridWidth = 1280
vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  const actual = await vi.importActual<typeof import('react-grid-layout')>('react-grid-layout')
  return {
    ...actual,
    WidthProvider: (C: React.ComponentType<Record<string, unknown>>) =>
      function Fixed(p: Record<string, unknown>) {
        return React.createElement(C, { ...p, width: gridWidth })
      },
  }
})
// jsdom has no layout: report the same width the grid was given.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return (this as HTMLElement).classList.contains('react-grid-layout') ? gridWidth : 0
  },
})
vi.mock('@/components/widgets/MetricsWidget', () => ({ MetricsWidget: () => null }))
vi.mock('@/components/widgets/CronWidget', () => ({ CronWidget: () => null }))
vi.mock('@/components/widgets/HeartbeatWidget', () => ({ HeartbeatWidget: () => null }))

import { WidgetGrid } from '@/components/Grid/WidgetGrid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Item = { i: string; x: number; y: number; w: number; h: number; minW?: number; maxW?: number; minH?: number; maxH?: number }

let root: Root
let host: HTMLDivElement
let onIds: ReturnType<typeof vi.fn<(widgetIds: string[]) => void>>

async function mount(layouts: Record<string, Item[]>, editMode = true, cols: 2 | 4 | 8 = 4) {
  localStorage.clear()
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onIds = vi.fn<(widgetIds: string[]) => void>()
  await act(async () => root.render(<WidgetGrid cols={cols} editMode={editMode} onLayoutChange={onIds} />))
  await act(async () => {})
}

const stored = (bp = 'lg'): Item[] => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!)[bp]
const box = (bp = 'lg') =>
  Object.fromEntries(stored(bp).map((l) => [l.i, [l.x, l.y, l.w, l.h]]))
// The card is the outermost element of a widget: the one that holds its title.
const card = (title: string) =>
  Array.from(host.querySelectorAll('h2'))
    .find((h) => h.textContent === title)!
    .closest<HTMLElement>('[class*="rounded-xl"]')!
const announcer = () => host.querySelector('[data-grid-announcer]')!
async function press(title: string, key: string, init: KeyboardEventInit = {}) {
  const el = card(title)
  await act(async () => {
    el.focus()
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
  await act(async () => {})
}

const THREE: Item[] = [
  { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
  { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
  { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 },
]

afterEach(async () => {
  gridWidth = 1280
  await act(async () => root.unmount())
  host.remove()
})

describe('widget cards as keyboard targets', () => {
  it('are focusable, named and described in edit mode', async () => {
    await mount({ lg: THREE })
    const cards = host.querySelectorAll<HTMLElement>('[class*="rounded-xl"]')
    expect(cards).toHaveLength(3)
    for (const el of Array.from(cards)) {
      expect(el.getAttribute('tabindex')).toBe('0')
      expect(el.getAttribute('role')).toBe('group')
      expect(el.getAttribute('aria-roledescription')).toBe('movable widget')
      expect(el.getAttribute('aria-label')).toBe(el.querySelector('h2')!.textContent)
      const hint = document.getElementById(el.getAttribute('aria-describedby')!)
      expect(hint?.textContent).toContain('Shift')
    }
    // One description shared by every card, hidden so it is not read as widget content.
    const ids = new Set(Array.from(cards).map((el) => el.getAttribute('aria-describedby')))
    expect(ids.size).toBe(1)
    const hints = host.querySelectorAll('span[hidden]')
    expect(hints).toHaveLength(1)
    expect(host.querySelector('.sr-only [id]')).toBeNull()
    expect(card('CPU + RAM').className).toContain('focus-visible:outline-2')
    // Room around the card when it is scrolled into view, so its focus outline is not cut off.
    expect(card('CPU + RAM').className).toContain('scroll-m-2')
  })

  it('add no tab stop and no semantics when locked', async () => {
    await mount({ lg: THREE }, false)
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(0)
    expect(host.querySelector('[aria-roledescription]')).toBeNull()
    expect(host.querySelector('[role="group"]')).toBeNull()
    expect(host.querySelector('[aria-describedby]')).toBeNull()
    expect(host.querySelector('span[hidden]')).toBeNull()
    // Keys on a locked card do nothing.
    const el = card('CPU + RAM')
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })
    expect(box().metrics).toEqual([0, 0, 1, 2])
    expect(announcer().textContent).toBe('')
  })

  it('lose the tab stop when edit mode is switched off', async () => {
    await mount({ lg: THREE })
    await act(async () => root.render(<WidgetGrid cols={4} editMode={false} />))
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(0)
  })
})

describe('Arrow moves by one cell', () => {
  it('moves right into free space, persists and reports the ids', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 2, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowRight')
    expect(box().metrics).toEqual([1, 0, 1, 2])
    expect(box().cron).toEqual([2, 0, 1, 2])
    expect(onIds).toHaveBeenLastCalledWith(expect.arrayContaining(['metrics', 'cron']))
  })

  it('moves left and keeps the other breakpoints untouched', async () => {
    const xxs = [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 0, y: 2, w: 1, h: 2 }]
    await mount({ lg: [{ i: 'metrics', x: 2, y: 0, w: 1, h: 2 }, { i: 'cron', x: 0, y: 2, w: 1, h: 2 }], xxs })
    await press('CPU + RAM', 'ArrowLeft')
    expect(box().metrics).toEqual([1, 0, 1, 2])
    expect(stored('xxs').map((l) => [l.i, l.x, l.y])).toEqual([['metrics', 0, 0], ['cron', 0, 2]])
  })

  it('moves down under a widget and up again', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 1, y: 0, w: 1, h: 2 }, { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 }] })
    await press('Cron Jobs', 'ArrowDown')
    // Nothing is below Cron Jobs: vertical compaction puts it back, so no change.
    expect(box().cron).toEqual([1, 0, 1, 2])
    await press('CPU + RAM', 'ArrowDown')
    // CPU + RAM swaps places with Heartbeat Pulse like a pointer drag would.
    expect(box().heartbeat).toEqual([0, 0, 1, 1])
    expect(box().metrics).toEqual([0, 1, 1, 2])
    await press('CPU + RAM', 'ArrowUp')
    expect(box().metrics[1]).toBeLessThan(1)
  })

  it('clamps at the grid edges and says so without writing', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 2, h: 2 }, { i: 'cron', x: 2, y: 0, w: 2, h: 2 }] })
    const before = localStorage.getItem(LAYOUT_STORAGE_KEY)
    onIds.mockClear()
    await press('CPU + RAM', 'ArrowLeft')
    await press('CPU + RAM', 'ArrowUp')
    expect(box().metrics).toEqual([0, 0, 2, 2])
    expect(announcer().textContent).toContain('cannot move up')
    await press('Cron Jobs', 'ArrowRight')
    expect(box().cron).toEqual([2, 0, 2, 2])
    expect(announcer().textContent).toBe('Cron Jobs: cannot move right, already at the right edge')
    expect(onIds).not.toHaveBeenCalled()
    // No write happened beyond what the grid itself normalised on mount.
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).lg.map((l: Item) => [l.i, l.x, l.y])).toEqual(
      JSON.parse(before!).lg.map((l: Item) => [l.i, l.x, l.y]),
    )
  })

  it('pushes a colliding widget away like a pointer move', async () => {
    await mount({ lg: THREE })
    await press('CPU + RAM', 'ArrowRight')
    // The same input through react-grid-layout's own helpers (what onDrag uses).
    const { cloneLayout, compact, getLayoutItem, moveElement } = await import('react-grid-layout/build/utils')
    const work = cloneLayout(THREE as never)
    const expected = compact(moveElement(work, getLayoutItem(work, 'metrics')!, 1, 0, true, false, 'vertical', 4, false), 'vertical', 4)
    expect(box()).toEqual(Object.fromEntries(expected.map((l) => [l.i, [l.x, l.y, l.w, l.h]])))
    // And concretely: Cron Jobs went below CPU + RAM, Heartbeat Pulse moved up.
    expect(box().metrics).toEqual([1, 0, 1, 2])
    expect(box().cron).toEqual([1, 2, 2, 2])
    expect(box().heartbeat).toEqual([0, 0, 1, 1])
  })

  it('uses the layout of the breakpoint on screen and the columns of that breakpoint', async () => {
    gridWidth = 400 // xs: one column
    await mount({
      lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 1, y: 0, w: 1, h: 2 }],
      xs: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 0, y: 2, w: 1, h: 2 }],
    })
    await press('CPU + RAM', 'ArrowRight') // one column: nothing to the right
    expect(announcer().textContent).toContain('cannot move right')
    await press('CPU + RAM', 'ArrowDown')
    expect(box('xs').cron).toEqual([0, 0, 1, 2])
    expect(box('xs').metrics).toEqual([0, 2, 1, 2])
    expect(box('lg').metrics).toEqual([0, 0, 1, 2])
    expect(box('lg').cron).toEqual([1, 0, 1, 2])
  })
})

describe('Shift+Arrow resizes by one cell', () => {
  it('grows and shrinks width and height', async () => {
    await mount({ lg: [{ i: 'cron', x: 0, y: 0, w: 2, h: 2 }] })
    await press('Cron Jobs', 'ArrowRight', { shiftKey: true })
    expect(box().cron).toEqual([0, 0, 3, 2])
    await press('Cron Jobs', 'ArrowDown', { shiftKey: true })
    expect(box().cron).toEqual([0, 0, 3, 3])
    await press('Cron Jobs', 'ArrowLeft', { shiftKey: true })
    await press('Cron Jobs', 'ArrowUp', { shiftKey: true })
    expect(box().cron).toEqual([0, 0, 2, 2])
    expect(box().cron.slice(0, 2)).toEqual([0, 0])
  })

  it('stops at the column count, counted from the widget position', async () => {
    await mount({ lg: [{ i: 'cron', x: 2, y: 0, w: 2, h: 2 }] })
    await press('Cron Jobs', 'ArrowRight', { shiftKey: true })
    expect(box().cron).toEqual([2, 0, 2, 2])
    expect(announcer().textContent).toBe('Cron Jobs: size limit reached')
  })

  it('respects minW/minH and maxW/maxH of the item', async () => {
    await mount({ lg: [{ i: 'cron', x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxW: 3, maxH: 3 }] })
    await press('Cron Jobs', 'ArrowLeft', { shiftKey: true })
    await press('Cron Jobs', 'ArrowUp', { shiftKey: true })
    expect(box().cron).toEqual([0, 0, 2, 2])
    await press('Cron Jobs', 'ArrowRight', { shiftKey: true })
    await press('Cron Jobs', 'ArrowRight', { shiftKey: true })
    await press('Cron Jobs', 'ArrowDown', { shiftKey: true })
    await press('Cron Jobs', 'ArrowDown', { shiftKey: true })
    expect(box().cron).toEqual([0, 0, 3, 3])
  })

  it('never shrinks below one cell without min sizes', async () => {
    await mount({ lg: [{ i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 }] })
    await press('Heartbeat Pulse', 'ArrowLeft', { shiftKey: true })
    await press('Heartbeat Pulse', 'ArrowUp', { shiftKey: true })
    expect(box().heartbeat).toEqual([0, 0, 1, 1])
  })

  it('pushes a widget in the way down, like a pointer resize', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 }] })
    await press('CPU + RAM', 'ArrowDown', { shiftKey: true })
    expect(box().metrics).toEqual([0, 0, 1, 3])
    expect(box().heartbeat).toEqual([0, 3, 1, 1])
  })
})

describe('announcements, focus and keys', () => {
  it('announces moves and resizes in a polite live region', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 2, y: 2, w: 1, h: 1 }] })
    expect(announcer().getAttribute('aria-live')).toBe('polite')
    expect(announcer().getAttribute('aria-atomic')).toBe('true')
    await press('CPU + RAM', 'ArrowRight')
    expect(announcer().textContent).toBe('CPU + RAM moved to column 2, row 1')
    await press('CPU + RAM', 'ArrowRight', { shiftKey: true })
    expect(announcer().textContent).toBe('CPU + RAM resized to 2 by 2')
  })

  it('announces a repeated message again by re-creating its node', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowLeft')
    const first = announcer().firstElementChild
    await press('CPU + RAM', 'ArrowLeft')
    expect(announcer().textContent).toBe('CPU + RAM: cannot move left, already at the left edge')
    expect(announcer().firstElementChild).not.toBe(first)
  })

  it('keeps focus on the moved widget', async () => {
    await mount({ lg: THREE })
    await press('CPU + RAM', 'ArrowRight')
    expect(document.activeElement).toBe(card('CPU + RAM'))
    await press('CPU + RAM', 'ArrowRight', { shiftKey: true })
    expect(document.activeElement).toBe(card('CPU + RAM'))
  })

  it('Escape leaves the widget for the grid container', async () => {
    await mount({ lg: THREE })
    await press('CPU + RAM', 'Escape')
    expect(document.activeElement).toBe(host.firstElementChild)
    expect(box().metrics).toEqual([0, 0, 1, 2])
  })

  it('Escape on a card is spent: it does not also dismiss a pending Undo notice', async () => {
    await mount({ lg: THREE })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove Heartbeat Pulse widget"]')!.click())
    const notice = () => document.querySelector('[data-undo-notice]')!.textContent
    expect(notice()).toContain('Heartbeat Pulse removed')
    const el = card('CPU + RAM')
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => {
      el.focus()
      el.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(notice()).toContain('Heartbeat Pulse removed')
    // Escape from anywhere else still dismisses it.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(notice()).toBe('')
  })

  it('ignores other keys, modified arrows and keys from inside the widget', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 2, y: 0, w: 1, h: 2 }] })
    for (const [key, init] of [['Tab', {}], ['e', {}], ['Enter', {}], ['ArrowRight', { ctrlKey: true }], ['ArrowRight', { altKey: true }], ['ArrowRight', { metaKey: true }]] as const) {
      const el = card('CPU + RAM')
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      await act(async () => {
        el.dispatchEvent(ev)
      })
      // Tab and the global shortcut key must stay untouched by the card.
      if (key === 'Tab' || key === 'e') expect(ev.defaultPrevented).toBe(false)
    }
    expect(box().metrics).toEqual([0, 0, 1, 2])
    expect(announcer().textContent).toBe('')

    const inner = card('CPU + RAM').querySelector('button')!
    const innerEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    await act(async () => {
      inner.dispatchEvent(innerEvent)
    })
    expect(innerEvent.defaultPrevented).toBe(false)
    expect(box().metrics).toEqual([0, 0, 1, 2])
  })

  it('prevents the page scroll for the arrows it handles', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    const el = card('CPU + RAM')
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    await act(async () => {
      el.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
  })

  it('lets the global e shortcut see a key pressed on a focused card', async () => {
    await mount({ lg: THREE })
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    await press('CPU + RAM', 'e')
    window.removeEventListener('keydown', seen)
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('undo after a keyboard move', () => {
  it('treats a keyboard move like a drag: Undo keeps the moved layout', async () => {
    await mount({
      lg: [
        { i: 'heartbeat', x: 0, y: 0, w: 1, h: 1 },
        { i: 'cron', x: 1, y: 0, w: 1, h: 2 },
        { i: 'metrics', x: 0, y: 2, w: 2, h: 2 },
      ],
    })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove CPU + RAM widget"]')!.click())
    await press('Cron Jobs', 'ArrowRight')
    expect(box().cron).toEqual([2, 0, 1, 2])
    const undo = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!
    await act(async () => undo.click())
    await act(async () => {})
    expect(box().cron).toEqual([2, 0, 1, 2])
    expect(stored().map((l) => l.i).sort()).toEqual(['cron', 'heartbeat', 'metrics'])
  })
})

describe('locking the layout while a card has focus', () => {
  const rerender = async (edit: boolean) => {
    await act(async () => root.render(<WidgetGrid cols={4} editMode={edit} onLayoutChange={onIds} />))
  }

  it('moves focus to the grid container and announces it', async () => {
    await mount({ lg: THREE })
    await act(async () => card('CPU + RAM').focus())
    await rerender(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(host.firstElementChild)
    expect(announcer().textContent).toBe('Layout locked')
  })

  it('also covers a browser that already dropped focus to the body', async () => {
    await mount({ lg: THREE })
    await act(async () => card('CPU + RAM').focus())
    // What Chrome does when the focused element loses its tabindex.
    const el = card('CPU + RAM')
    el.addEventListener('blur', () => {})
    await act(async () => {
      el.blur()
    })
    expect(document.activeElement).toBe(document.body)
    await rerender(false)
    expect(document.activeElement).toBe(host.firstElementChild)
    expect(announcer().textContent).toBe('Layout locked')
  })

  it('leaves focus alone when it is elsewhere, and does not announce', async () => {
    await mount({ lg: THREE })
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await act(async () => card('CPU + RAM').focus())
    await act(async () => outside.focus())
    await rerender(false)
    expect(document.activeElement).toBe(outside)
    expect(announcer().textContent).toBe('')
    outside.remove()
  })

  it('does not steal focus from the page body after the user clicked away from the grid', async () => {
    await mount({ lg: THREE })
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await act(async () => card('CPU + RAM').focus())
    await act(async () => outside.focus())
    await act(async () => outside.blur())
    expect(document.activeElement).toBe(document.body)
    await rerender(false)
    expect(document.activeElement).toBe(document.body)
    expect(announcer().textContent).toBe('')
    outside.remove()
  })

  it('does nothing when focus never was in the grid', async () => {
    await mount({ lg: THREE })
    await rerender(false)
    expect(document.activeElement).toBe(document.body)
    expect(announcer().textContent).toBe('')
  })

  it('does not announce when edit mode is switched on', async () => {
    await mount({ lg: THREE }, false)
    await rerender(true)
    expect(announcer().textContent).toBe('')
  })
})

describe('scrolling the moved card into view', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockClear()
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('scrolls the moved card (block nearest) when its transition ends', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }, { i: 'cron', x: 2, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowRight')
    expect(scrollIntoView).not.toHaveBeenCalled()
    const el = card('CPU + RAM')
    await act(async () => {
      el.dispatchEvent(new Event('transitionend', { bubbles: true }))
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(el)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    // The fallback timer is gone once it ran.
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('ignores a transition that ended on something inside the card', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowDown', { shiftKey: true })
    const inner = card('CPU + RAM').querySelector('h2')!
    await act(async () => {
      inner.dispatchEvent(new Event('transitionend', { bubbles: true }))
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('falls back to a timer when no transition runs, for a resize too', async () => {
    await mount({ lg: [{ i: 'cron', x: 0, y: 0, w: 2, h: 2 }] })
    await press('Cron Jobs', 'ArrowDown', { shiftKey: true })
    await act(async () => {
      vi.advanceTimersByTime(399)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(2)
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does not scroll when the key changed nothing', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowLeft')
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('a second key replaces the pending scroll instead of adding one', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowRight')
    await press('CPU + RAM', 'ArrowRight')
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('cancels the pending scroll when the grid unmounts', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowRight')
    await act(async () => root.render(<div />))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
    // afterEach unmounts the (now different) tree again.
  })
})

describe('key auto-repeat', () => {
  it('does not announce the same refusal again while the key is held, but announces real changes', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowLeft')
    const first = announcer().firstElementChild
    expect(announcer().textContent).toContain('cannot move left')
    await press('CPU + RAM', 'ArrowLeft', { repeat: true })
    await press('CPU + RAM', 'ArrowLeft', { repeat: true })
    expect(announcer().firstElementChild).toBe(first)
    // A separate press (not a repeat) is announced again.
    await press('CPU + RAM', 'ArrowLeft')
    expect(announcer().firstElementChild).not.toBe(first)
    // A held key that really moves is announced on every step.
    await press('CPU + RAM', 'ArrowRight', { repeat: true })
    expect(announcer().textContent).toBe('CPU + RAM moved to column 2, row 1')
    const moved = announcer().firstElementChild
    await press('CPU + RAM', 'ArrowRight', { repeat: true })
    expect(announcer().textContent).toBe('CPU + RAM moved to column 3, row 1')
    expect(announcer().firstElementChild).not.toBe(moved)
  })

  it('announces a refusal after a different message even on a repeat', async () => {
    await mount({ lg: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }] })
    await press('CPU + RAM', 'ArrowRight')
    await press('CPU + RAM', 'ArrowLeft')
    await press('CPU + RAM', 'ArrowLeft', { repeat: true })
    expect(announcer().textContent).toContain('cannot move left')
  })
})
