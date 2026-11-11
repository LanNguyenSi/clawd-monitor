// @vitest-environment jsdom
/**
 * Settings page: token generate/rename failures are shown, the token name field has a visible
 * label with a readable placeholder, the password message is announced with the right role,
 * and the theme buttons report their state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { mount, unmountAll, flush, click, createElement as h } from './dom-helpers'
import SettingsPage from '@/app/settings/page'

vi.mock('next/navigation', () => {
  const router = { replace: () => {}, push: () => {} }
  return { useRouter: () => router, usePathname: () => '/settings' }
})
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    const { children, href, ...rest } = props as { children: unknown; href: string }
    return h('a', { href, ...rest }, children as never)
  },
}))

const TOKENS = [
  { id: 't1', name: 'vps-main', createdAt: '2026-01-01T00:00:00Z' },
  { id: 't2', name: 'staging', createdAt: '2026-01-02T00:00:00Z' },
]

type Impl = (url: string, init?: RequestInit) => Promise<Response>
let postImpl: Impl
let patchImpl: Impl
let passwordImpl: Impl
let listCalls: number
let postCalls: number
let patchCalls: string[]
let tokens: typeof TOKENS

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  listCalls = 0
  postCalls = 0
  patchCalls = []
  tokens = [...TOKENS]
  postImpl = async () => json({ token: 'secret-value', id: 't3', name: 'new-one' }, 201)
  patchImpl = async () => json({ ok: true })
  passwordImpl = async () => json({ ok: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings/tokens' && init?.method === 'POST') {
        postCalls++
        return postImpl(url, init)
      }
      if (url.startsWith('/api/settings/tokens/') && init?.method === 'PATCH') {
        patchCalls.push(url)
        return patchImpl(url, init)
      }
      if (url === '/api/settings/tokens') {
        listCalls++
        return json({ tokens })
      }
      if (url === '/api/auth/change-password') return passwordImpl(url, init)
      return json({ authenticated: true })
    }),
  )
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

/** The input a visible <label> names, the way getByLabelText finds it. */
function byLabel(root: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(root.querySelectorAll('label')).find((l) => l.textContent === text)
  expect(label, `label "${text}"`).toBeDefined()
  const control = label!.control
  expect(control, `control of label "${text}"`).toBeInstanceOf(HTMLInputElement)
  return control as HTMLInputElement
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

const button = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement

describe('generate token', () => {
  it('shows an alert, keeps the typed name and shows no token when the server answers 500', async () => {
    postImpl = async () => json({ error: 'boom' }, 500)
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    await type(input, 'new-one')
    await submit(input.form!)
    const alert = root.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Could not generate token "new-one"')
    expect(alert?.textContent).toContain('500')
    expect(input.value).toBe('new-one')
    expect(root.textContent).not.toContain('Token generated for')
    expect(root.textContent).not.toContain('secret-value')
    // A failed create must not reload the list; a reload would also hide nothing but cost a request.
    expect(listCalls).toBe(1)
    expect(button(root, '+ Generate Token').disabled).toBe(false)
  })

  it('shows an alert and keeps the typed name when the request itself fails', async () => {
    postImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    await type(input, 'new-one')
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('network error')
    expect(input.value).toBe('new-one')
    expect(root.textContent).not.toContain('Token generated for')
    expect(button(root, '+ Generate Token').disabled).toBe(false)
  })

  it('clears the error and shows the token when a retry succeeds', async () => {
    postImpl = async () => json({}, 500)
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    await type(input, 'new-one')
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).not.toBeNull()
    postImpl = async () => json({ token: 'secret-value', id: 't3', name: 'new-one' }, 201)
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.textContent).toContain('Token generated for')
    expect(root.textContent).toContain('secret-value')
    expect(input.value).toBe('')
  })

  it('does not send a blank name and shows no error for it', async () => {
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    await type(input, '   ')
    await submit(input.form!)
    expect(postCalls).toBe(0)
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('rename token', () => {
  async function startRename(root: HTMLElement) {
    await click(root.querySelector('button[aria-label="Edit name of token vps-main"]')!)
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Name for token vps-main"]')!
    await type(input, 'renamed')
    return input
  }

  it('shows an alert, keeps the edit open and the old name when the PATCH is not OK', async () => {
    patchImpl = async () => json({ error: 'nope' }, 500)
    const root = await mountSettings()
    const input = await startRename(root)
    await submit(input.form!)
    const alert = root.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Could not rename token "vps-main"')
    expect(alert?.textContent).toContain('500')
    expect(patchCalls).toEqual(['/api/settings/tokens/t1'])
    // The edit stays open with the typed name, and the list was not reloaded.
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Name for token vps-main"]')?.value).toBe('renamed')
    expect(listCalls).toBe(1)
    // Cancelling shows the old name again.
    await click(button(root, 'Cancel'))
    expect(root.textContent).toContain('vps-main')
    expect(root.textContent).not.toContain('renamed')
  })

  it('shows an alert and keeps the edit open when the request itself fails', async () => {
    patchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    const root = await mountSettings()
    const input = await startRename(root)
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('network error')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Name for token vps-main"]')?.value).toBe('renamed')
    expect(listCalls).toBe(1)
  })

  it('closes the edit, reloads the list and shows no alert on success', async () => {
    patchImpl = async () => {
      tokens = [{ ...TOKENS[0], name: 'renamed' }, TOKENS[1]]
      return json({ ok: true })
    }
    const root = await mountSettings()
    const input = await startRename(root)
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.querySelector('input[aria-label^="Name for token"]')).toBeNull()
    expect(root.textContent).toContain('renamed')
    expect(listCalls).toBe(2)
  })

  it('clears the rename error when a retry of the same edit succeeds', async () => {
    patchImpl = async () => json({}, 500)
    const root = await mountSettings()
    const input = await startRename(root)
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).not.toBeNull()
    patchImpl = async () => json({ ok: true })
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.querySelector('input[aria-label^="Name for token"]')).toBeNull()
  })

  it('clears an earlier rename error when the edit is started again', async () => {
    patchImpl = async () => json({}, 500)
    const root = await mountSettings()
    const input = await startRename(root)
    await submit(input.form!)
    expect(root.querySelector('[role="alert"]')).not.toBeNull()
    await click(button(root, 'Cancel'))
    await click(root.querySelector('button[aria-label="Edit name of token vps-main"]')!)
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('token name field', () => {
  it('is found by its visible label, whose text is not the placeholder', async () => {
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    expect(input.id).toBe('token-name')
    expect(input.getAttribute('aria-label')).toBeNull()
    expect(input.placeholder).not.toBe('')
    expect(input.placeholder).not.toBe('Agent name')
    expect(input.required).toBe(true)
  })

  // Tailwind zinc values pinned in globals.css (WCAG relative luminance).
  const ZINC: Record<string, string> = { '50': 'fafafa', '400': 'a1a1aa', '500': '71717a', '800': '27272a' }
  const luminance = (hex: string) => {
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const shade = (classes: string[], prefix: string) => {
    const hit = classes.find((c) => c.startsWith(prefix))
    expect(hit, prefix).toBeDefined()
    const hex = ZINC[hit!.slice(prefix.length)]
    expect(hex, `${hit} is in the ZINC table`).toBeDefined()
    return hex
  }

  it('keeps the placeholder at 4.5:1 on the input background in both schemes', async () => {
    const root = await mountSettings()
    const classes = byLabel(root, 'Agent name').className.split(/\s+/)
    expect(ratio(shade(classes, 'placeholder-zinc-'), shade(classes, 'bg-zinc-'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(shade(classes, 'dark:placeholder-zinc-'), shade(classes, 'dark:bg-zinc-'))).toBeGreaterThanOrEqual(4.5)
  })

  it('stacks the input and the button below sm and lets the input shrink', async () => {
    const root = await mountSettings()
    const input = byLabel(root, 'Agent name')
    expect(input.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']))
    const row = input.parentElement!.className.split(/\s+/)
    expect(row).toEqual(expect.arrayContaining(['flex', 'flex-col', 'sm:flex-row']))
    expect(input.parentElement!.contains(button(root, '+ Generate Token'))).toBe(true)
  })
})

describe('password change message', () => {
  const fillAndSubmit = async (root: HTMLElement) => {
    const form = byLabel(root, 'Current password').form!
    await submit(form)
  }

  it('is an alert after a failure and a status after a success, as a fresh element each time', async () => {
    // The success path schedules a logout 2 s later; keep that one timer from ever firing.
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
      ms === 2000 ? (0 as unknown as ReturnType<typeof setTimeout>) : realSetTimeout(fn, ms)) as typeof setTimeout)
    passwordImpl = async () => json({ error: 'Invalid password' }, 400)
    const root = await mountSettings()
    await fillAndSubmit(root)
    const failed = root.querySelector('[role="alert"]')
    expect(failed?.textContent).toBe('Invalid password')
    expect(failed?.tagName).toBe('P')
    expect(root.querySelector('[role="status"]')).toBeNull()

    passwordImpl = async () => json({ ok: true })
    await fillAndSubmit(root)
    const ok = root.querySelector('[role="status"]')
    expect(ok?.textContent).toContain('Password updated')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    // The role is never swapped on a node that is already in the page: the old message is cleared first.
    expect(ok).not.toBe(failed)
  })

  it('is an alert when the request itself fails', async () => {
    passwordImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    const root = await mountSettings()
    await fillAndSubmit(root)
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Network error')
    expect(root.querySelector('[role="status"]')).toBeNull()
  })

  it('renders nothing before a password change is attempted', async () => {
    const root = await mountSettings()
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.querySelector('[role="status"]')).toBeNull()
  })
})

describe('theme buttons', () => {
  const group = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="group"][aria-label="Theme"]')!

  it('are a labelled group whose pressed state follows the theme', async () => {
    localStorage.clear()
    const root = await mountSettings()
    const [light, dark] = ['Light', 'Dark'].map((t) =>
      Array.from(group(root).querySelectorAll('button')).find((b) => b.textContent?.includes(t))!,
    )
    expect(group(root).querySelectorAll('button')).toHaveLength(2)
    // The provider defaults to dark.
    expect([light.getAttribute('aria-pressed'), dark.getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    await click(light)
    expect([light.getAttribute('aria-pressed'), dark.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    await click(dark)
    expect([light.getAttribute('aria-pressed'), dark.getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })
})
