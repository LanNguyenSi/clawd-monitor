// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const grid = vi.hoisted(() => ({ props: null as null | { isDraggable: boolean } }))

vi.mock('react-grid-layout', () => ({
  WidthProvider: (c: unknown) => c,
  Responsive: (props: { isDraggable: boolean }) => {
    grid.props = props
    return null
  },
}))
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

import DashboardPage from '@/app/dashboard/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('the e shortcut unlocks the dashboard that opens locked, and locks it again', async () => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ authenticated: true, agents: [] }), { status: 200 })),
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<DashboardPage />))
  await act(async () => {})
  expect(grid.props?.isDraggable).toBe(false)
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
  })
  expect(grid.props?.isDraggable).toBe(true)
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
  })
  expect(grid.props?.isDraggable).toBe(false)
})
