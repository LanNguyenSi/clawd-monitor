// @vitest-environment jsdom
/**
 * Keyboard and ARIA behaviour of the navbar dropdown menus and the shortcut
 * overlay: trigger state, Escape, focus hand-off and return, arrow keys.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { AgentSwitcher } from '@/components/Nav/AgentSwitcher'
import { AddWidgetMenu } from '@/components/Nav/AddWidgetMenu'
import { UserMenu } from '@/components/Nav/UserMenu'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ActiveAgentProvider } from '@/lib/active-agent'
import { mount, unmountAll, flush, click, key, createElement as h } from './dom-helpers'

vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props as { children: unknown; href: string }
    return h('a', { href, ...rest }, children as never)
  },
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        agents: [
          { agentId: 'a1', name: 'alpha', online: true, lastSnapshotAt: Date.now() },
          { agentId: 'a2', name: 'beta', online: false, lastSnapshotAt: Date.now() },
        ],
      }),
    })),
  )
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

type MenuCase = {
  name: string
  render: () => ReturnType<typeof mount>
  triggerSelector: string
  menuLabel: string
}

const noop = () => {}
const cases: MenuCase[] = [
  {
    name: 'AgentSwitcher',
    render: async () => {
      const m = await mount(h(AgentSwitcher))
      await flush()
      return m
    },
    triggerSelector: 'button[aria-haspopup="menu"]',
    menuLabel: 'Select agent',
  },
  {
    name: 'AddWidgetMenu',
    render: () => mount(h(AddWidgetMenu, { onAdd: noop, activeWidgetIds: [] })),
    triggerSelector: 'button[aria-haspopup="menu"]',
    menuLabel: 'Add widget',
  },
  {
    name: 'UserMenu',
    render: () => mount(h(UserMenu)),
    triggerSelector: 'button[aria-haspopup="menu"]',
    menuLabel: 'User menu',
  },
]

describe.each(cases)('$name dropdown semantics', (c) => {
  it('announces popup state on the trigger', async () => {
    const { container } = await c.render()
    const trigger = container.querySelector<HTMLButtonElement>(c.triggerSelector)!
    expect(trigger).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const menu = container.querySelector('[role="menu"]')!
    expect(menu).not.toBeNull()
    expect(menu.getAttribute('aria-label')).toBe(c.menuLabel)
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0)
  })

  it('moves focus to the first item on open', async () => {
    const { container } = await c.render()
    await click(container.querySelector(c.triggerSelector)!)
    const first = container.querySelector('[role="menuitem"]')
    expect(document.activeElement).toBe(first)
  })

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const { container } = await c.render()
    const trigger = container.querySelector<HTMLButtonElement>(c.triggerSelector)!
    await click(trigger)
    expect(container.querySelector('[role="menu"]')).not.toBeNull()
    await key(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('arrow keys, Home and End move between items and wrap', async () => {
    const { container } = await c.render()
    await click(container.querySelector(c.triggerSelector)!)
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.length).toBeGreaterThan(1)
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(items[1])
    await key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(items[0])
    await key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(items[items.length - 1])
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(items[0])
    await key(document.activeElement!, 'End')
    expect(document.activeElement).toBe(items[items.length - 1])
    await key(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(items[0])
  })

  it('clicking the backdrop closes the menu and returns focus to the trigger', async () => {
    const { container } = await c.render()
    const trigger = container.querySelector<HTMLButtonElement>(c.triggerSelector)!
    await click(trigger)
    await click(container.querySelector('.fixed.inset-0')!)
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('menu item activation', () => {
  it('AddWidgetMenu: choosing an item adds it, closes the menu and refocuses the trigger', async () => {
    const onAdd = vi.fn()
    const { container } = await mount(h(AddWidgetMenu, { onAdd, activeWidgetIds: [] }))
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    await click(container.querySelector('[role="menuitem"]')!)
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('AgentSwitcher: choosing an agent closes the menu and refocuses the trigger', async () => {
    const { container } = await mount(h(AgentSwitcher))
    await flush()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    // "All agents", "alpha", "beta", remove button of the offline "beta"
    expect(items.map((i) => i.textContent?.trim().split('\n')[0])).toContain('All agents')
    expect(items.some((i) => i.getAttribute('aria-label') === 'Remove offline agent beta')).toBe(true)
    await click(items[1])
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('Tab closes the menu and keeps focus on the trigger', async () => {
    const { container } = await mount(h(UserMenu))
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    await key(document.activeElement!, 'Tab')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('KeyboardShortcuts overlay', () => {
  async function open() {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const m = await mount(h(KeyboardShortcuts, { onRefresh: noop, onToggleTheme: noop, onToggleEditMode: noop }))
    await key(window, '?')
    return { ...m, opener }
  }

  it('renders nothing until opened', async () => {
    const { container } = await mount(
      h(KeyboardShortcuts, { onRefresh: noop, onToggleTheme: noop, onToggleEditMode: noop }),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('is a modal dialog named by its heading, with a labelled close button', async () => {
    const { container } = await open()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const heading = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
    expect(heading.textContent).toBe('Keyboard Shortcuts')
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Close keyboard shortcuts')
  })

  it('moves focus into the dialog on open', async () => {
    const { container } = await open()
    expect(document.activeElement).toBe(container.querySelector('[role="dialog"]'))
  })

  it('returns focus to the previously focused element on Escape', async () => {
    const { container, opener } = await open()
    await key(window, 'Escape')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('returns focus when closed with the close button', async () => {
    const { container, opener } = await open()
    await click(container.querySelector('button[aria-label="Close keyboard shortcuts"]')!)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on a click on the backdrop but not on the dialog body', async () => {
    const { container } = await open()
    await click(container.querySelector('[role="dialog"]')!)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await click(container.querySelector('[role="dialog"]')!.parentElement!)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps Tab inside the dialog', async () => {
    const { container } = await open()
    await key(container.querySelector('[role="dialog"]')!, 'Tab')
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="Close keyboard shortcuts"]'))
  })
})

describe('AgentSwitcher removing an offline agent', () => {
  async function openMenu(wrap = false) {
    const m = await mount(wrap ? h(ActiveAgentProvider, null, h(AgentSwitcher)) : h(AgentSwitcher))
    await flush()
    const trigger = m.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    const remove = m.container.querySelector<HTMLElement>('button[aria-label="Remove offline agent beta"]')!
    return { ...m, trigger, remove }
  }

  function expectFocusInsideMenu(container: HTMLElement) {
    const menu = container.querySelector('[role="menu"]')!
    expect(menu).not.toBeNull()
    expect(menu.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
  }

  it('click: focus moves to a remaining menu item and Escape still closes the menu', async () => {
    const { container, trigger, remove } = await openMenu()
    remove.focus()
    await click(remove)
    await flush()
    expect(container.textContent).not.toContain('beta')
    expectFocusInsideMenu(container)
    // the nearest remaining item (alpha's select button) takes over
    expect(document.activeElement?.textContent).toContain('alpha')
    await key(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keyboard: Enter on the remove button keeps the menu keyboard-operable', async () => {
    const { container, trigger } = await openMenu()
    // End jumps to the last item, which is the remove button of the offline agent
    await key(document.activeElement!, 'End')
    const remove = document.activeElement as HTMLElement
    expect(remove.getAttribute('aria-label')).toBe('Remove offline agent beta')
    await key(remove, 'Enter')
    // a browser turns Enter on a button into a click
    await click(remove)
    await flush()
    expect(container.textContent).not.toContain('beta')
    expectFocusInsideMenu(container)
    // arrow keys still work from the new position
    await key(document.activeElement!, 'ArrowDown')
    expectFocusInsideMenu(container)
    await key(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('removing the selected agent closes the menu and returns focus to the trigger', async () => {
    localStorage.setItem('clawd-monitor:activeAgentId', 'a2')
    try {
      const { container, trigger, remove } = await openMenu(true)
      await click(remove)
      await flush()
      expect(container.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    } finally {
      localStorage.removeItem('clawd-monitor:activeAgentId')
    }
  })

  it('a failed removal keeps the entry and the focus on its button', async () => {
    const { container, remove } = await openMenu()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })))
    remove.focus()
    await click(remove)
    await flush()
    expect(container.textContent).toContain('beta')
    expect(document.activeElement).toBe(remove)
  })
})

describe('menu and global shortcuts together', () => {
  const spies = { onRefresh: vi.fn(), onToggleTheme: vi.fn(), onToggleEditMode: vi.fn() }

  async function mountBoth() {
    const m = await mount(
      h('div', null, h(UserMenu), h(KeyboardShortcuts, spies)),
    )
    const trigger = m.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await click(trigger)
    return { ...m, trigger }
  }

  beforeEach(() => {
    Object.values(spies).forEach((f) => f.mockClear())
  })

  it('Escape in an open menu closes only the menu and never reaches window listeners', async () => {
    const { container, trigger } = await mountBoth()
    const windowListener = vi.fn()
    window.addEventListener('keydown', windowListener)
    try {
      await key(document.activeElement!, 'Escape')
      expect(windowListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowListener)
    }
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('? is ignored while focus is in an open menu: no overlay, menu stays open', async () => {
    const { container } = await mountBoth()
    await key(document.activeElement!, '?')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[role="menu"]')).not.toBeNull()
    expect(container.querySelector('[role="menu"]')!.contains(document.activeElement)).toBe(true)
  })

  it('letter shortcuts are ignored inside an open menu and work again once it is closed', async () => {
    const { container } = await mountBoth()
    await key(document.activeElement!, 't')
    expect(spies.onToggleTheme).not.toHaveBeenCalled()
    await key(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    await key(document.activeElement!, 't')
    expect(spies.onToggleTheme).toHaveBeenCalledTimes(1)
    await key(document.activeElement!, '?')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe('KeyboardShortcuts typing guard', () => {
  const spies = { onRefresh: vi.fn(), onToggleTheme: vi.fn(), onToggleEditMode: vi.fn() }

  beforeEach(async () => {
    Object.values(spies).forEach((f) => f.mockClear())
    await mount(h(KeyboardShortcuts, spies))
  })

  function editable(): HTMLElement {
    const el = document.createElement('div')
    // jsdom does not implement isContentEditable; browsers derive it from contenteditable
    Object.defineProperty(el, 'isContentEditable', { value: true })
    return el
  }

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    ['contenteditable element', editable],
  ])('ignores shortcuts typed into a %s', async (_name, make) => {
    const el = make()
    document.body.appendChild(el)
    await key(el, 't')
    await key(el, '?')
    expect(spies.onToggleTheme).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('still handles shortcuts from other elements and from the window', async () => {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    await key(btn, 't')
    await key(window, 'r')
    expect(spies.onToggleTheme).toHaveBeenCalledTimes(1)
    expect(spies.onRefresh).toHaveBeenCalledTimes(1)
  })
})
