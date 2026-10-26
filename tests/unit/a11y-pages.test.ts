// @vitest-environment jsdom
/**
 * Semantics of the pages and shared widget chrome: form labels, landmarks,
 * headings, scrollable regions.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import LoginPage from '@/app/(auth)/login/page'
import SettingsPage from '@/app/settings/page'
import DashboardPage from '@/app/dashboard/page'
import { GridItem } from '@/components/Grid/GridItem'
import { ScrollRegion } from '@/components/widgets/ScrollRegion'
import { MARKDOWN_HEADINGS } from '@/components/widgets/MemoryWidget'
import ReactMarkdown from 'react-markdown'
import { mount, unmountAll, flush, click, createElement as h } from './dom-helpers'
import { act } from 'react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props as { children: unknown; href: string }
    return h('a', { href, ...rest }, children as never)
  },
}))
// The grid pulls in react-grid-layout and every widget; the page chrome is
// what is under test here.
vi.mock('@/components/Grid/WidgetGrid', () => ({
  WidgetGrid: () => h('div', { 'data-testid': 'grid' }),
}))

function stubFetch(tokens: Array<{ id: string; name: string; createdAt: string }> = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/settings/tokens')) {
        return { ok: true, json: async () => ({ tokens }) }
      }
      if (String(url).startsWith('/api/agents/list')) {
        return { ok: true, json: async () => ({ agents: [] }) }
      }
      return { ok: true, json: async () => ({ authenticated: true }) }
    }),
  )
}

beforeEach(() => stubFetch())
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('login page', () => {
  it('pairs a label with the password input and sets the autofill hint', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(h(LoginPage)), 'text/html')
    const input = doc.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(input.id).not.toBe('')
    const label = doc.querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent).toBe('Admin password')
    expect(input.getAttribute('autocomplete')).toBe('current-password')
  })

  it('wraps the content in a main landmark with the page h1', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(h(LoginPage)), 'text/html')
    expect(doc.querySelectorAll('main').length).toBe(1)
    expect(doc.querySelectorAll('main h1').length).toBe(1)
  })

  it('announces a failed login through role=alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Invalid password' }) })))
    const { container } = await mount(h(LoginPage))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('Invalid password')
  })
})

describe('settings page', () => {
  it('labels every password input and the token inputs, with matching autofill hints', async () => {
    stubFetch([{ id: 't1', name: 'Lava VPS', createdAt: new Date().toISOString() }])
    const { container } = await mount(h(SettingsPage))
    await flush()
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    expect(inputs).toHaveLength(3)
    const hints = inputs.map((i) => i.getAttribute('autocomplete'))
    expect(hints).toEqual(['current-password', 'new-password', 'new-password'])
    const ids = new Set(inputs.map((i) => i.id))
    expect(ids.size).toBe(3)
    for (const input of inputs) {
      expect(input.id).not.toBe('')
      const label = container.querySelector(`label[for="${input.id}"]`)
      expect(label, `label for ${input.id}`).not.toBeNull()
    }
    // new-token name input
    expect(container.querySelector('input[aria-label="Agent name"]')).not.toBeNull()
    // rename input of an existing token
    await click(container.querySelector('button[title="Edit name"]')!)
    expect(container.querySelector('input[aria-label="Name for token Lava VPS"]')).not.toBeNull()
  })

  it('has a main landmark and exactly one h1', async () => {
    const { container } = await mount(h(SettingsPage))
    await flush()
    expect(container.querySelectorAll('main').length).toBe(1)
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(container.querySelector('main')!.contains(h1s[0])).toBe(true)
  })
})

describe('dashboard page', () => {
  it('has a main landmark holding the grid and exactly one h1', async () => {
    const { container } = await mount(h(DashboardPage))
    await flush()
    const mains = container.querySelectorAll('main')
    expect(mains).toHaveLength(1)
    expect(mains[0].querySelector('[data-testid="grid"]')).not.toBeNull()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(mains[0].querySelector('h1')).not.toBeNull()
    // the shortcut hint is page content, so it lives inside the landmark
    expect(mains[0].textContent).toContain('for shortcuts')
  })
})

describe('GridItem', () => {
  it('renders the widget title as an h2 and names the remove button', () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(h(GridItem, { title: 'Cron Jobs', editMode: true, onRemove: () => {}, children: h('p', null, 'x') })),
      'text/html',
    )
    expect(doc.querySelector('h2')?.textContent).toBe('Cron Jobs')
    expect(doc.querySelector('button[title="Remove widget"]')?.getAttribute('aria-label')).toBe('Remove Cron Jobs widget')
  })
})

describe('ScrollRegion', () => {
  it('is a focusable, named region', () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(h(ScrollRegion, { label: 'Cron jobs', className: 'flex-1', children: 'rows' })),
      'text/html',
    )
    const el = doc.querySelector('div')!
    expect(el.getAttribute('role')).toBe('region')
    expect(el.getAttribute('aria-label')).toBe('Cron jobs')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.className).toContain('overflow-y-auto')
    expect(el.className).toContain('flex-1')
    expect(el.className).toContain('focus-visible:outline-2')
  })

  it('forwards the scroll ref to the element', async () => {
    const ref = { current: null as HTMLDivElement | null }
    const { container } = await mount(h(ScrollRegion, { label: 'x', scrollRef: ref, children: 'y' }))
    expect(ref.current).toBe(container.firstElementChild)
  })
})

describe('widget scroll containers', () => {
  const dir = join(__dirname, '../../src/components/widgets')
  const files = readdirSync(dir).filter((f) => f.endsWith('Widget.tsx'))

  it('no widget scrolls through a bare overflow-y-auto element', () => {
    const offenders = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('overflow-y-auto'))
    expect(offenders).toEqual([])
  })

  it('every widget that scrolls uses a labelled ScrollRegion', () => {
    const users = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('<ScrollRegion'))
    expect(users.length).toBeGreaterThanOrEqual(10)
    for (const f of users) {
      const src = readFileSync(join(dir, f), 'utf8')
      const tags = src.match(/<ScrollRegion\b[^>]*>/g) ?? []
      for (const tag of tags) expect(tag, `${f}: ${tag}`).toMatch(/label="[^"]+"/)
    }
  })
})

describe('memory markdown headings', () => {
  it('never emits an h1 or h2 inside a widget', () => {
    const html = renderToStaticMarkup(
      h(ReactMarkdown, { components: MARKDOWN_HEADINGS }, '# a\n## b\n### c\n#### d\n##### e\n###### f'),
    )
    expect(html).not.toMatch(/<h[12]\b/)
    expect(html).toContain('<h3>a</h3>')
    expect(html).toContain('<h4>b</h4>')
    expect(html).toContain('<h5>c</h5>')
    expect(html.match(/<h6>/g)).toHaveLength(3)
  })
})
