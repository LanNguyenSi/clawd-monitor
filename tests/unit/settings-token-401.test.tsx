// @vitest-environment jsdom
/**
 * Settings page: a 401 from a token action (generate, rename, revoke) means the session expired
 * and sends the user to /login with no retry hint; any other failure keeps its message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { mount, unmountAll, flush, click, createElement as h } from './dom-helpers'
import SettingsPage from '@/app/settings/page'

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings' }))
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props as { children: unknown; href: string }
    return h('a', { href, ...rest }, children as never)
  },
}))

const TOKENS = [{ id: 't1', name: 'vps-main', createdAt: '2026-01-01T00:00:00Z' }]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let actionStatus: number

beforeEach(() => {
  router.replace.mockClear()
  actionStatus = 401
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method
      if (url === '/api/settings/tokens' && method === 'POST') return json({ error: 'x' }, actionStatus)
      if (url.startsWith('/api/settings/tokens/') && (method === 'PATCH' || method === 'DELETE')) {
        return json({ error: 'x' }, actionStatus)
      }
      if (url === '/api/settings/tokens') return json({ tokens: TOKENS })
      return json({ authenticated: true })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mountSettings(): Promise<HTMLElement> {
  const { container } = await mount(h(SettingsPage))
  await flush()
  return container
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}

async function generate(root: HTMLElement) {
  const label = Array.from(root.querySelectorAll('label')).find((l) => l.textContent === 'Agent name')!
  const input = label.control as HTMLInputElement
  await type(input, 'new-one')
  await submit(input.form!)
}

async function rename(root: HTMLElement) {
  await click(root.querySelector('button[aria-label="Edit name of token vps-main"]')!)
  const input = root.querySelector<HTMLInputElement>('input[aria-label="Name for token vps-main"]')!
  await type(input, 'renamed')
  await submit(input.form!)
}

async function revoke(root: HTMLElement) {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent === 'Revoke')!
  await click(b)
}

const actions = { generate, rename, revoke }

describe.each(Object.entries(actions))('%s token', (_name, run) => {
  it('sends the user to /login without an error message on 401', async () => {
    const root = await mountSettings()
    expect(router.replace).not.toHaveBeenCalled()
    await run(root)
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/login')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.textContent).not.toContain('try again')
    expect(root.textContent).not.toContain('HTTP 401')
  })

  it('keeps its error message and stays on the page on 500', async () => {
    actionStatus = 500
    const root = await mountSettings()
    await run(root)
    expect(router.replace).not.toHaveBeenCalled()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('HTTP 500')
  })
})
