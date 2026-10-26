// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// Stable router identity: the page's auth effect depends on it.
const router = vi.hoisted(() => ({ replace: () => {}, push: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/settings',
}))

import SettingsPage from '@/app/settings/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TOKENS = [
  { id: 't1', name: 'vps-main', createdAt: '2026-01-01T00:00:00Z' },
  { id: 't2', name: 'a-very-long-agent-token-name-for-wrapping', createdAt: '2026-01-02T00:00:00Z' },
]

let host: HTMLDivElement
let root: Root
let deleteImpl: (url: string) => Promise<Response>
let deleteCalls: string[]
let listCalls: number

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<SettingsPage />)
  })
  await act(async () => {})
}

const revokeButtons = () =>
  Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Revoke') as HTMLButtonElement[]

async function click(b: HTMLElement) {
  await act(async () => {
    b.click()
  })
  await act(async () => {})
}

beforeEach(() => {
  deleteCalls = []
  listCalls = 0
  deleteImpl = async () => json({ ok: true })
  let tokens = [...TOKENS]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.startsWith('/api/settings/tokens/')) {
        deleteCalls.push(url)
        const res = await deleteImpl(url)
        if (res.ok) tokens = tokens.filter((t) => `/api/settings/tokens/${t.id}` !== url)
        return res
      }
      if (url === '/api/settings/tokens') {
        listCalls++
        return json({ tokens })
      }
      return json({ authenticated: true })
    }),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('token revoke', () => {
  it('names the token in each revoke button label', async () => {
    await mount()
    const labels = revokeButtons().map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Revoke token vps-main',
      'Revoke token a-very-long-agent-token-name-for-wrapping',
    ])
  })

  it('asks for confirmation naming the token and does not delete when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await mount()
    await click(revokeButtons()[0])
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('"vps-main"')
    expect(deleteCalls).toEqual([])
    expect(revokeButtons()).toHaveLength(2)
  })

  it('deletes and removes the token after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount()
    await click(revokeButtons()[0])
    expect(deleteCalls).toEqual(['/api/settings/tokens/t1'])
    expect(revokeButtons()).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows an alert and keeps the token when the server rejects the delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteImpl = async () => json({ error: 'nope' }, 500)
    await mount()
    await click(revokeButtons()[0])
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('vps-main')
    expect(alert?.textContent).toContain('500')
    expect(revokeButtons()).toHaveLength(2)
    // A failed delete must not reload the list (a reload would hide the failure).
    expect(listCalls).toBe(1)
  })

  it('shows an alert and keeps the token on a network error', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    await mount()
    await click(revokeButtons()[0])
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('network error')
    expect(revokeButtons()).toHaveLength(2)
    expect(listCalls).toBe(1)
  })

  it('clears the previous error on the next successful revoke', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteImpl = async () => json({}, 500)
    await mount()
    await click(revokeButtons()[0])
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    deleteImpl = async () => json({ ok: true })
    await click(revokeButtons()[0])
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('clears a stale error when a later confirmation is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteImpl = async () => json({}, 500)
    await mount()
    await click(revokeButtons()[0])
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    confirm.mockReturnValue(false)
    await click(revokeButtons()[1])
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(deleteCalls).toHaveLength(1)
  })

  it('ignores a second click while a revoke is in flight and marks the button busy', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let release!: () => void
    deleteImpl = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json({ ok: true }))
      })
    await mount()
    const first = revokeButtons()[0]
    await click(first)
    await click(first)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(deleteCalls).toEqual(['/api/settings/tokens/t1'])
    expect(revokeButtons().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
    await act(async () => release())
    await act(async () => {})
    expect(revokeButtons()).toHaveLength(1)
    expect(revokeButtons()[0].getAttribute('aria-disabled')).toBe('false')
    await click(revokeButtons()[0])
    expect(deleteCalls).toHaveLength(2)
  })
})
