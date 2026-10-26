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
        // decorative divider slash (aria-hidden, no information)
        if (line.includes('>/</span>')) return
        offenders.push(`${file.replace(/.*src\//, 'src/')}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
  /** Every string literal of a source file (quoted, or the static text of a template), with its line. */
  function stringLiterals(src: string): { text: string; line: number }[] {
    const out: { text: string; line: number }[] = []
    const lineOf = (i: number) => src.slice(0, i).split('\n').length
    for (const m of src.matchAll(/'(?:[^'\n\\]|\\.)*'|"(?:[^"\n\\]|\\.)*"/g)) {
      out.push({ text: m[0].slice(1, -1), line: lineOf(m.index!) })
    }
    for (const m of src.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
      out.push({ text: m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ' '), line: lineOf(m.index!) })
    }
    return out
  }

  /** True when the literal has a plain text-zinc-400/500 without a dark:text-zinc-100..400 partner in it. */
  function unpairedZinc(text: string): boolean {
    return /(?<![\w:-])text-zinc-[45]00\b/.test(text) && !/\bdark:text-zinc-[1-4]00\b/.test(text)
  }

  // Tailwind palette values used on light surfaces (WCAG relative luminance below).
  const TEXT: Record<string, string> = {
    'green-500': '22c55e', 'green-600': '16a34a', 'green-700': '15803d', 'green-800': '166534',
    'yellow-500': 'eab308', 'yellow-600': 'ca8a04', 'yellow-700': 'a16207', 'yellow-800': '854d0e',
    'amber-500': 'f59e0b', 'amber-600': 'd97706', 'amber-700': 'b45309', 'amber-800': '92400e', 'amber-900': '78350f',
    'red-500': 'ef4444', 'red-600': 'dc2626', 'red-700': 'b91c1c', 'red-800': '991b1b',
    'orange-500': 'f97316', 'orange-600': 'ea580c', 'orange-700': 'c2410c', 'orange-800': '9a3412',
    'indigo-500': '6366f1', 'indigo-600': '4f46e5', 'indigo-700': '4338ca', 'indigo-800': '3730a3', 'indigo-900': '312e81',
  }
  const SURFACE: Record<string, string> = {
    white: 'ffffff', 'zinc-50': 'fafafa', 'zinc-100': 'f4f4f5', 'red-50': 'fef2f2',
    'indigo-50': 'eef2ff', 'indigo-100': 'e0e7ff', 'amber-50': 'fffbeb',
  }
  const luminance = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (fg: string, bg: string) => {
    const [a, b] = [luminance(fg), luminance(bg)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  /**
   * Plain (non-variant) coloured text in the literal against its own plain bg-*-50/100
   * surface, or against the page background (zinc-100, the darkest light surface) when
   * the literal names none. Returns one message per pair below 4.5:1.
   */
  function lowContrast(text: string): string[] {
    const tokens = text.split(/\s+/).filter((t) => !t.includes(':'))
    const surfaceKey = tokens.map((t) => /^bg-(.+)$/.exec(t)?.[1]).find((k) => k && SURFACE[k]) ?? 'zinc-100'
    const out: string[] = []
    for (const t of tokens) {
      const key = /^text-(.+)$/.exec(t)?.[1]
      if (!key || !TEXT[key]) continue
      const r = ratio(TEXT[key], SURFACE[surfaceKey])
      if (r < 4.5) out.push(`${t} on ${surfaceKey} = ${r.toFixed(2)}:1`)
    }
    return out
  }

  it('gives every plain text-zinc-400/500 a dark:text-zinc-100..400 pair in the same string literal', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      for (const { text, line } of stringLiterals(readFileSync(file, 'utf8'))) {
        if (unpairedZinc(text)) offenders.push(`${file.replace(/.*src\//, 'src/')}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every plain coloured text at 4.5:1 on its light surface', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      for (const { text, line } of stringLiterals(readFileSync(file, 'utf8'))) {
        for (const o of lowContrast(text)) offenders.push(`${file.replace(/.*src\//, 'src/')}:${line} ${o}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps white button text at 4.5:1 in the hover state (indigo-500 is 4.46:1)', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      for (const { text, line } of stringLiterals(readFileSync(file, 'utf8'))) {
        if (/(?<![\w:-])text-white\b/.test(text) && /\bhover:bg-(indigo|green|red|yellow|orange)-[1-5]00\b/.test(text)) {
          offenders.push(`${file.replace(/.*src\//, 'src/')}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('checks every branch of a ternary on its own, not the whole expression', () => {
    const src = "const c = `x ${ok ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-500'}`"
    expect(stringLiterals(src).filter((l) => unpairedZinc(l.text)).map((l) => l.text)).toEqual(['text-zinc-500'])
  })

  it('rejects green-600 on page backgrounds and red-600 on a red-50 surface, accepts the 700 shades', () => {
    expect(lowContrast('text-green-600 dark:text-green-400')).toHaveLength(1)
    expect(lowContrast('text-green-700 dark:text-green-400')).toEqual([])
    expect(lowContrast('text-red-600 bg-red-50 dark:text-red-400')).toHaveLength(1)
    expect(lowContrast('text-red-700 bg-red-50 dark:text-red-400')).toEqual([])
  })

  it('does not let a dark hover colour equal the dark resting colour', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/\bdark:text-zinc-400\b/.test(line) && /\bdark:hover:text-zinc-400\b/.test(line)) {
          offenders.push(`${file.replace(/.*src\//, 'src/')}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
