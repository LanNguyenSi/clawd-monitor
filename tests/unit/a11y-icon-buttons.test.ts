// @vitest-environment jsdom
/**
 * Icon-only buttons: accessible names, hidden decorative glyphs, 24px minimum
 * target classes, the mobile menu toggle state, and the contrast floor for
 * secondary text.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Navbar } from '@/components/Nav/Navbar'
import { GridItem } from '@/components/Grid/GridItem'
import SettingsPage from '@/app/settings/page'
import DashboardPage from '@/app/dashboard/page'
import { ActiveAgentProvider } from '@/lib/active-agent'
import { mount, unmountAll, flush, click, createElement as h } from './dom-helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props as { children: unknown; href: string }
    return h('a', { href, ...rest }, children as never)
  },
}))
vi.mock('@/components/Grid/WidgetGrid', () => ({
  WidgetGrid: () => h('div', { 'data-testid': 'grid' }),
}))

const TOKENS = [{ id: 't1', name: 'Lava VPS', createdAt: new Date().toISOString() }]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/settings/tokens')) {
        return { ok: true, json: async () => ({ tokens: TOKENS }) }
      }
      if (String(url).startsWith('/api/agents/list')) {
        return { ok: true, json: async () => ({ agents: [] }) }
      }
      return { ok: true, json: async () => ({ authenticated: true }) }
    }),
  )
})
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const EMOJI = /\p{Extended_Pictographic}|[✕☰]/u

/** Every glyph-only text node under root must sit inside an aria-hidden ancestor. */
function exposedGlyphs(root: Element): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? ''
    if (EMOJI.test(text) && !n.parentElement!.closest('[aria-hidden="true"]')) out.push(text.trim())
  }
  return out
}

function navbar(editMode = true) {
  return h(
    ActiveAgentProvider,
    null,
    h(Navbar, { cols: 4, onColsChange: () => {}, editMode, onToggleEditMode: () => {}, onResetLayout: () => {}, onAddWidget: () => {} }),
  )
}

describe('navbar mobile menu toggle', () => {
  it('is named, reports its expanded state and points at the controlled panel', async () => {
    const { container } = await mount(navbar())
    await flush()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-layout-controls"]')!
    expect(toggle.getAttribute('aria-label')).toBe('Layout controls')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#mobile-layout-controls')).toBeNull()
    await click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#mobile-layout-controls')).not.toBeNull()
    expect(toggle.className).toContain('min-w-8')
    expect(toggle.className).toContain('min-h-8')
  })
})

describe('decorative glyphs', () => {
  it('hides every emoji and symbol glyph in the navbar, open mobile panel included', async () => {
    const { container } = await mount(navbar())
    await flush()
    await click(container.querySelector('button[aria-controls="mobile-layout-controls"]')!)
    expect(container.querySelector('#mobile-layout-controls')!.textContent).toContain('editing')
    expect(exposedGlyphs(container)).toEqual([])
  })

  it('hides the emoji of the open user menu', async () => {
    const { container } = await mount(navbar())
    await flush()
    await click(container.querySelector('button[aria-label="User menu"]')!)
    const menu = container.querySelector('[role="menu"]')!
    expect(menu.textContent).toContain('Settings')
    expect(exposedGlyphs(menu)).toEqual([])
  })

  it('hides the settings page emoji and names the rename button', async () => {
    const { container } = await mount(h(SettingsPage))
    await flush()
    const pencil = container.querySelector<HTMLButtonElement>('button[title="Edit name"]')!
    expect(pencil.getAttribute('aria-label')).toBe('Edit name of token Lava VPS')
    expect(pencil.className).toContain('min-w-6')
    expect(pencil.className).toContain('min-h-6')
    expect(exposedGlyphs(container.querySelector('main')!).filter((t) => !t.startsWith('⚠'))).toEqual([])
  })
})

describe('GridItem icon button', () => {
  const html = (editMode: boolean) =>
    new DOMParser().parseFromString(
      renderToStaticMarkup(h(GridItem, { title: 'Cron Jobs', editMode, onRemove: () => {}, children: h('p', null, 'x') })),
      'text/html',
    )

  it('hides the cross glyph, keeps a 24px target and hides the drag dots', () => {
    const doc = html(true)
    const btn = doc.querySelector('button[aria-label="Remove Cron Jobs widget"]')!
    expect(btn.className).toContain('min-w-6')
    expect(btn.className).toContain('min-h-6')
    expect(btn.querySelector('[aria-hidden="true"]')?.textContent).toBe('✕')
    expect(doc.querySelector('[data-testid="drag-dots"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(doc.querySelectorAll('[data-testid="drag-dots"] div')).toHaveLength(3)
  })
})

describe('shortcut hint', () => {
  it('flows after the grid instead of floating over widgets', async () => {
    const { container } = await mount(h(DashboardPage))
    await flush()
    const hint = Array.from(container.querySelectorAll('main div')).find((d) => d.textContent?.includes('for shortcuts'))!
    expect(hint.className).not.toMatch(/\b(fixed|absolute)\b/)
    expect(hint.previousElementSibling?.getAttribute('data-testid')).toBe('grid')
  })
})

describe('secondary text contrast floor', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : []
    })
  }

  it('uses no dark:text-zinc-600/700 on text outside the allowed spots', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\bdark:text-zinc-[67]00\b/.test(line)) return
        // decorative divider slash, and the token revoke button (own task)
        if (line.includes('>/</span>') || line.includes('border-zinc-200 dark:border-zinc-800 hover:border-red-300')) return
        offenders.push(`${file.replace(/.*src\//, 'src/')}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
