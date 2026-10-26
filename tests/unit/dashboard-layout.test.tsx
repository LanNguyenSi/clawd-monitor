// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

type GridProps = {
  layouts: Record<string, { i: string; x: number; y: number; w: number; h: number }[]>
  onLayoutChange: (current: unknown[], all: unknown) => void
}

const grid = vi.hoisted(() => ({ props: null as unknown, mounts: 0 }))

vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  return {
    WidthProvider: (c: unknown) => c,
    Responsive: (props: unknown) => {
      grid.props = props
      React.useEffect(() => {
        grid.mounts += 1
      }, [])
      return null
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}))
vi.mock('@/components/Grid/GridItem', () => ({ GridItem: () => null }))
vi.mock('@/components/Nav/AgentSwitcher', () => ({ AgentSwitcher: () => null }))
vi.mock('@/components/Nav/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/AddAgentModal', () => ({ AddAgentModal: () => null }))
vi.mock('@/components/KeyboardShortcuts', () => ({ KeyboardShortcuts: () => null }))

import DashboardPage from '@/app/dashboard/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const currentProps = () => grid.props as GridProps
const lgIds = () => currentProps().layouts.lg.map((l) => l.i)

const SAVED = {
  lg: [
    { i: 'log-tail', x: 0, y: 0, w: 4, h: 2 },
    { i: 'metrics', x: 4, y: 0, w: 4, h: 2 },
  ],
  xxs: [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }],
}

let host: HTMLDivElement
let root: Root

async function mountDashboard() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<DashboardPage />)
  })
  await act(async () => {})
}

function resetButton(): HTMLButtonElement {
  const b = Array.from(host.querySelectorAll('button')).find((x) => x.textContent === 'Reset layout')
  if (!b) throw new Error('Reset layout button not found')
  return b as HTMLButtonElement
}

beforeEach(() => {
  grid.props = null
  grid.mounts = 0
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

describe('dashboard layout wiring', () => {
  it('passes stored layouts per breakpoint to the grid', async () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(SAVED))
    await mountDashboard()
    const layouts = currentProps().layouts
    expect(layouts.lg.map((l) => l.i)).toEqual(['log-tail', 'metrics'])
    expect(layouts.xxs.map((l) => l.i)).toEqual(['metrics'])
    expect(layouts.xxs[0].w).toBe(1)
  })

  it('persists the per-breakpoint layouts, not only the current one', async () => {
    await mountDashboard()
    const current = [{ i: 'metrics', x: 0, y: 0, w: 1, h: 2 }]
    const all = { lg: SAVED.lg, xxs: current }
    await act(async () => currentProps().onLayoutChange(current, all))
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) as string)).toEqual(all)
  })

  describe('reset layout', () => {
    it('asks for confirmation and restores the default layout when confirmed', async () => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(SAVED))
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await mountDashboard()
      expect(lgIds()).toEqual(['log-tail', 'metrics'])
      const mountsBefore = grid.mounts
      await act(async () => resetButton().click())
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(String(confirm.mock.calls[0][0])).toMatch(/default/i)
      expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull()
      expect(grid.mounts).toBe(mountsBefore + 1)
      expect(lgIds()).toEqual(['metrics', 'agent-status', 'cron', 'docker'])
    })

    it('changes nothing when the confirmation is cancelled', async () => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(SAVED))
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await mountDashboard()
      const mountsBefore = grid.mounts
      await act(async () => resetButton().click())
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) as string)).toEqual(SAVED)
      expect(grid.mounts).toBe(mountsBefore)
      expect(lgIds()).toEqual(['log-tail', 'metrics'])
    })
  })
})
