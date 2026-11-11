// @vitest-environment jsdom
/**
 * Navbar segmented controls: the column buttons and the edit toggle have a name that carries
 * their meaning and a pressed state, in the desktop bar and in the mobile panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { Navbar } from '@/components/Nav/Navbar'
import { ActiveAgentProvider } from '@/lib/active-agent'
import type { ColCount } from '@/types'
import { mount, unmountAll, flush, click, createElement as h } from './dom-helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).startsWith('/api/agents/list') ? { agents: [] } : { authenticated: true }),
    })),
  )
})
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** Holds cols and edit mode the way the dashboard does, so a click changes what the buttons report. */
function Harness({ initialCols = 4 as ColCount, initialEdit = false }) {
  const [cols, setCols] = useState<ColCount>(initialCols)
  const [edit, setEdit] = useState(initialEdit)
  return h(
    ActiveAgentProvider,
    null,
    h(Navbar, { cols, onColsChange: setCols, editMode: edit, onToggleEditMode: () => setEdit((v) => !v) }),
  )
}

const pressed = (els: Element[]) => els.map((e) => e.getAttribute('aria-pressed'))

function colsGroups(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="group"][aria-label="Columns"]'))
}

describe('column buttons', () => {
  it('desktop: a labelled group, names with the meaning, pressed state follows the click', async () => {
    const { container } = await mount(h(Harness))
    await flush()
    const [group] = colsGroups(container)
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['2 columns', '4 columns', '8 columns'])
    // The visible text is kept.
    expect(buttons.map((b) => b.textContent)).toEqual(['2', '4', '8'])
    expect(pressed(buttons)).toEqual(['false', 'true', 'false'])
    await click(buttons[2])
    expect(pressed(buttons)).toEqual(['false', 'false', 'true'])
    await click(buttons[0])
    expect(pressed(buttons)).toEqual(['true', 'false', 'false'])
  })

  it('mobile panel: the same group, names and pressed state', async () => {
    const { container } = await mount(h(Harness, { initialCols: 8 }))
    await flush()
    await click(container.querySelector('button[aria-controls="mobile-layout-controls"]')!)
    const panel = container.querySelector<HTMLElement>('#mobile-layout-controls')!
    const group = colsGroups(panel)
    expect(group).toHaveLength(1)
    const buttons = Array.from(group[0].querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['2 columns', '4 columns', '8 columns'])
    expect(pressed(buttons)).toEqual(['false', 'false', 'true'])
    await click(buttons[1])
    expect(pressed(buttons)).toEqual(['false', 'true', 'false'])
  })
})

describe('edit layout toggle', () => {
  const toggles = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).filter((b) => b.textContent?.includes('Edit layout'))

  /** The visible text, without the aria-hidden icon. */
  const visibleText = (b: HTMLElement) =>
    Array.from(b.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
      .map((n) => n.textContent)
      .join('')
      .trim()

  /** WCAG 2.5.3: with no aria-label the name is the content, so the visible text is in it. */
  function expectLabelInName(b: HTMLElement) {
    expect(b.getAttribute('aria-label')).toBeNull()
    expect(b.getAttribute('aria-labelledby')).toBeNull()
    expect(visibleText(b)).toBe('Edit layout')
    expect(b.textContent).toContain(visibleText(b))
  }

  it('desktop: the visible text is the name, stable across states; aria-pressed flips', async () => {
    const { container } = await mount(h(Harness))
    await flush()
    const [toggle] = toggles(container)
    expectLabelInName(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await click(toggle)
    expectLabelInName(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await click(toggle)
    expectLabelInName(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('mobile panel: the same visible name and pressed state', async () => {
    const { container } = await mount(h(Harness, { initialEdit: true }))
    await flush()
    await click(container.querySelector('button[aria-controls="mobile-layout-controls"]')!)
    const toggle = toggles(container.querySelector<HTMLElement>('#mobile-layout-controls')!)[0]
    expectLabelInName(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await click(toggle)
    expectLabelInName(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('does not show the old state words as the button text', async () => {
    const { container } = await mount(h(Harness))
    await flush()
    const [toggle] = toggles(container)
    expect(toggle.textContent).not.toMatch(/editing|locked/)
  })
})
