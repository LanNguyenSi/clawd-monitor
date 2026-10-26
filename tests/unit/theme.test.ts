// @vitest-environment jsdom
/**
 * Unit tests for src/lib/theme.tsx (ThemeProvider / useTheme).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { mount, unmountAll, click, createElement as h } from './dom-helpers'

const KEY = 'clawd-monitor:theme'

function Probe() {
  const { theme, setTheme, toggleTheme } = useTheme()
  return h(
    'div',
    null,
    h('span', { id: 'theme' }, theme),
    h('button', { id: 'light', onClick: () => setTheme('light') }, 'light'),
    h('button', { id: 'toggle', onClick: toggleTheme }, 'toggle'),
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  unmountAll()
  document.body.innerHTML = ''
})

describe('ThemeProvider', () => {
  it('defaults to dark when nothing is stored', async () => {
    const { container } = await mount(h(ThemeProvider, null, h(Probe)))
    expect(container.querySelector('#theme')!.textContent).toBe('dark')
  })

  it('restores the stored theme on mount and syncs the html class', async () => {
    localStorage.setItem(KEY, 'light')
    document.documentElement.classList.add('dark')
    const { container } = await mount(h(ThemeProvider, null, h(Probe)))
    expect(container.querySelector('#theme')!.textContent).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('setTheme persists the choice and toggles the dark class', async () => {
    const { container } = await mount(h(ThemeProvider, null, h(Probe)))
    await click(container.querySelector('#light')!)
    expect(container.querySelector('#theme')!.textContent).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggleTheme flips dark and light and persists each step', async () => {
    const { container } = await mount(h(ThemeProvider, null, h(Probe)))
    const toggle = container.querySelector('#toggle')!
    await click(toggle)
    expect(container.querySelector('#theme')!.textContent).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await click(toggle)
    expect(container.querySelector('#theme')!.textContent).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
