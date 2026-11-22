// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

// Real react-grid-layout (its compaction decides where widgets land); only the
// width measurement is replaced: 1280 px is the lg breakpoint.
vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  const actual = await vi.importActual<typeof import('react-grid-layout')>('react-grid-layout')
  return {
    ...actual,
    WidthProvider: (C: React.ComponentType<Record<string, unknown>>) =>
      function Fixed(p: Record<string, unknown>) {
        return React.createElement(C, { ...p, width: 1280 })
      },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}))
vi.mock('@/components/Nav/AgentSwitcher', () => ({ AgentSwitcher: () => null }))
vi.mock('@/components/Nav/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/AddAgentModal', () => ({ AddAgentModal: () => null }))
vi.mock('@/lib/theme', () => ({
  ThemeProvider: ({ children }: { children: unknown }) => children,
  useTheme: () => ({ toggleTheme: vi.fn() }),
}))
vi.mock('@/lib/active-agent', () => ({
  ActiveAgentProvider: ({ children }: { children: unknown }) => children,
  useActiveAgent: () => ({ activeAgentId: null }),
}))
// Dashboard widgets as empty components: their data is beside the point here.
vi.mock('@/components/widgets/MetricsWidget', () => ({ MetricsWidget: () => null }))
vi.mock('@/components/widgets/CronWidget', () => ({ CronWidget: () => null }))
vi.mock('@/components/widgets/DockerWidget', () => ({ DockerWidget: () => null }))
vi.mock('@/components/widgets/AgentStatusWidget', () => ({ AgentStatusWidget: () => null }))
vi.mock('@/components/widgets/HeartbeatWidget', () => ({ HeartbeatWidget: () => null }))

import DashboardPage from '@/app/dashboard/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Item = { i: string; x: number; y: number; w: number; h: number }

const THREE: Item[] = [
  { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
  { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
  { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 },
]

const TWO: Item[] = [
  { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
  { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
]

let host: HTMLDivElement
let root: Root

async function mountDashboard(layout: Item[]) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ lg: layout }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<DashboardPage />))
  await act(async () => {})
}

const flush = async () => {
  await act(async () => {})
}

const stored = (): Item[] => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).lg
const pos = () => Object.fromEntries(stored().map((l) => [l.i, [l.x, l.y]]))
const noticeText = () => document.querySelector('[data-undo-notice]')?.textContent ?? ''
const undoButton = () =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Undo')
const removeButton = (title: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${title} widget"]`)
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click()
  })
  await flush()
}

async function enableEdit() {
  const toggle = Array.from(host.querySelectorAll('button')).find((b) => /Edit layout/.test(b.textContent ?? ''))!
  await click(toggle)
}

const removeByTitle = (title: string) => click(removeButton(title)!)

const pressR = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
  })

async function addByTitle(title: string) {
  const trigger = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '+ Widget')!
  await click(trigger)
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === title)!
  await click(item as HTMLElement)
}

const undoClick = async () => {
  await click(undoButton()!)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ authenticated: true, agents: [] }), { status: 200 })),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a pending undo across a grid remount', () => {
  it('survives the r refresh and Undo restores the widget at its old place', async () => {
    await mountDashboard(THREE)
    await enableEdit()
    await removeByTitle('Heartbeat Pulse')
    expect(noticeText()).toContain('Heartbeat Pulse removed')

    // The refresh really remounts the grid: its announcer is a new node.
    const announcerBefore = document.querySelector('[data-grid-announcer]')
    await pressR()
    expect(document.querySelector('[data-grid-announcer]')).not.toBe(announcerBefore)

    // Nothing changed in between: the notice is still there and the exact
    // snapshot path restores every position.
    expect(noticeText()).toContain('Heartbeat Pulse removed')
    await undoClick()
    expect(pos()).toEqual({ metrics: [0, 0], cron: [1, 0], heartbeat: [0, 2] })
    expect(noticeText()).toBe('')
    // Focus lands on the restored widget's remove button (pendingFocus).
    expect(document.activeElement).toBe(removeButton('Heartbeat Pulse'))
  })

  it('survives Add widget: Undo brings the removed widget back and keeps the added one', async () => {
    await mountDashboard(TWO)
    await enableEdit()
    await removeByTitle('CPU + RAM')
    expect(noticeText()).toContain('CPU + RAM removed')

    await addByTitle('Heartbeat Pulse')
    expect(stored().map((l) => l.i)).toEqual(['cron', 'heartbeat'])
    expect(noticeText()).toContain('CPU + RAM removed')

    // The add remount counted as an edit: Undo splices CPU + RAM back at its
    // old list index instead of restoring the snapshot (which would drop the
    // newly added widget).
    await undoClick()
    const ids = stored().map((l) => l.i)
    expect(ids).toEqual(['metrics', 'cron', 'heartbeat'])
    expect(stored().filter((l) => l.i === 'metrics')).toHaveLength(1)
    expect(noticeText()).toBe('')
  })

  it('clears when the added widget is the removed one: there is nothing to undo', async () => {
    await mountDashboard(TWO)
    await enableEdit()
    await removeByTitle('CPU + RAM')
    expect(noticeText()).toContain('CPU + RAM removed')

    await addByTitle('CPU + RAM')
    expect(noticeText()).toBe('')
    expect(undoButton()).toBeUndefined()
    expect(stored().filter((l) => l.i === 'metrics')).toHaveLength(1)
  })

  it('Reset layout clears the pending undo and announces it', async () => {
    await mountDashboard(THREE)
    await enableEdit()
    await removeByTitle('Cron Jobs')
    expect(noticeText()).toContain('Cron Jobs removed')
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const reset = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Reset layout')!
    await click(reset)

    // The reset happened and the notice is gone on purpose...
    expect(Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Docker Containers')
    expect(noticeText()).toBe('')
    expect(undoButton()).toBeUndefined()
    // ...and it is said out loud, in the live region outside the grid.
    const announced = document.querySelector('[data-undo-announcer]')?.textContent ?? ''
    expect(announced).toContain('Cron Jobs')
    expect(announced.toLowerCase()).toContain('layout reset')
    expect(announced.toLowerCase()).toContain('no longer available')
  })
})
