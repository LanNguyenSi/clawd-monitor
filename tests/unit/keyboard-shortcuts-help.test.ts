// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { mount, unmountAll, key, createElement as h } from './dom-helpers'

const noop = () => {}

afterEach(() => {
  unmountAll()
  document.body.innerHTML = ''
})

describe('shortcut help', () => {
  it('lists the card keys of the widget grid, once each', async () => {
    const { container } = await mount(h(KeyboardShortcuts, { onRefresh: noop, onToggleTheme: noop, onToggleEditMode: noop }))
    await key(window, '?')
    const rows = Array.from(container.querySelectorAll('[role="dialog"] .space-y-2 > div')).map((r) => r.textContent)
    expect(rows).toContain('Move the focused widget (edit mode)← ↑ → ↓')
    expect(rows).toContain('Resize the focused widget (edit mode)Shift + ← ↑ → ↓')
    expect(rows.some((r) => r?.startsWith('Close this help, or leave a focused widget'))).toBe(true)
    expect(new Set(rows).size).toBe(rows.length)
  })
})
