// @vitest-environment jsdom
/**
 * Small UI fixes: the Agent Status widget exposes the full last message as a
 * title on its truncated span, and the mobile layout controls wrap and keep
 * their labels on one line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { mount, unmountAll, click, flush, createElement as h } from './dom-helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: null, setActiveAgentId: () => {} }),
}))

import { AgentStatusWidget } from '@/components/widgets/AgentStatusWidget'
import { Navbar } from '@/components/Nav/Navbar'

const LONG = 'A very long last message that the widget truncates with an ellipsis in a narrow tile'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/proxy/sessions')
          ? { sessions: [{ sessionKey: 'agent:main', model: 'claude-x', lastMessage: LONG, lastActiveAt: new Date().toISOString() }] }
          : String(url).startsWith('/api/agents/list')
            ? { agents: [] }
            : { authenticated: true },
    })),
  )
})
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('AgentStatusWidget last message', () => {
  it('carries the full message as a title on the truncated span', async () => {
    const { container } = await mount(h(AgentStatusWidget))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const span = container.querySelector('span.truncate[title]') as HTMLElement | null
    expect(span).not.toBeNull()
    expect(span!.getAttribute('title')).toBe(LONG)
    expect(span!.textContent).toBe(LONG)
  })
})

describe('Navbar mobile layout controls', () => {
  it('wraps the row and keeps button labels on one line', async () => {
    const { container } = await mount(
      h(Navbar, {
        cols: 4,
        onColsChange: () => {},
        editMode: false,
        onToggleEditMode: () => {},
        onResetLayout: () => {},
        onAddWidget: () => {},
        activeWidgetIds: [],
      }),
    )
    await flush()
    const toggle = container.querySelector('button[aria-controls="mobile-layout-controls"]') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    await click(toggle)
    const panel = container.querySelector('#mobile-layout-controls') as HTMLElement
    expect(panel).not.toBeNull()
    const row = panel.firstElementChild as HTMLElement
    expect(row.classList.contains('flex-wrap')).toBe(true)
    for (const label of ['Edit layout', 'Reset layout', '+ Add Agent']) {
      const btn = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent!.includes(label))
      expect(btn, label).toBeDefined()
      expect(btn!.classList.contains('whitespace-nowrap'), label).toBe(true)
    }
  })
})

describe('Dashboard main region', () => {
  it('is a containing block so the grid live region (absolutely positioned) scrolls inside it, not the page', async () => {
    // The dashboard page needs the full app context to render; pin its
    // <main> className from the source instead.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8')
    const m = src.match(/<main className="([^"]*)"/)
    expect(m).not.toBeNull()
    const classes = m![1].split(/\s+/)
    expect(classes).toContain('relative')
    expect(classes).toContain('overflow-auto')
  })
})
