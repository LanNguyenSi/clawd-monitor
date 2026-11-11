// @vitest-environment jsdom
/**
 * AddAgentModal focus management and error announcement (WCAG 2.4.3 / 4.1.3):
 * Tab and Shift+Tab never leave the dialog: they wrap at the first and
 * last control and pull focus back into the dialog when it sits
 * outside the dialog's focusable set (a click on a non-focusable spot
 * parks it on <body>), the browser default is prevented exactly when
 * the trap moves focus, Escape and Cancel hand focus back to the
 * opener, the empty-name, repeated-error and origin failures are
 * announced through role="alert" elements, and a repeated identical
 * error remounts the alert so it is announced again.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { act } from 'react'
import { mount, unmountAll, click, key, createElement as h } from './dom-helpers'
import { AddAgentModal } from '@/components/AddAgentModal'

function Harness() {
  const [open, setOpen] = useState(false)
  return h(
    'div',
    null,
    h('button', { id: 'opener', onClick: () => setOpen(true) }, 'Add Agent'),
    h(AddAgentModal, { open, onClose: () => setOpen(false) }),
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

async function openModal() {
  const m = await mount(h(Harness))
  const opener = m.container.querySelector('#opener') as HTMLButtonElement
  opener.focus()
  await click(opener)
  // The modal focuses its first field one animation frame after opening.
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  })
  return { ...m, opener }
}

const controls = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))

/** Dispatches a cancelable Tab keydown and returns the event so the
 *  test can assert whether the trap called preventDefault on it. */
async function pressTab(el: Element, shift = false): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
  await act(async () => {
    el.dispatchEvent(event)
  })
  return event
}

/** Moves focus out of the dialog onto <body>, the way a click on a
 *  non-focusable spot of it does in a real browser (jsdom's
 *  HTMLElement.blur() falls back to <body>). */
function focusBody() {
  ;(document.activeElement as HTMLElement | null)?.blur()
  expect(document.activeElement).toBe(document.body)
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  unmountAll()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('AddAgentModal focus trap', () => {
  it('is a modal dialog named by its heading and focuses the name field on open', async () => {
    const { container } = await openModal()
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toContain('Add Agent')
    expect(document.activeElement).toBe(container.querySelector<HTMLInputElement>('#add-agent-name'))
  })

  it('wraps Tab from the last control back to the first and prevents the default', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    expect(items.length).toBeGreaterThanOrEqual(2)
    items[items.length - 1].focus()
    const event = await pressTab(items[items.length - 1])
    expect(document.activeElement).toBe(items[0])
    expect(event.defaultPrevented).toBe(true)
  })

  it('wraps Shift+Tab from the first control back to the last and prevents the default', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    items[0].focus()
    const event = await pressTab(items[0], true)
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pulls focus to the first control on Tab while focus is on the body', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    focusBody()
    const event = await pressTab(document.body)
    expect(document.activeElement).toBe(items[0])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pulls focus to the last control on Shift+Tab while focus is on the body', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    focusBody()
    const event = await pressTab(document.body, true)
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves Tab alone while focus is inside another modal opened on top', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    const inner = document.createElement('button')
    inner.textContent = 'Overlay close'
    overlay.appendChild(inner)
    document.body.appendChild(overlay)
    try {
      inner.focus()
      const event = await pressTab(inner)
      expect(event.defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(inner)
      expect(items).not.toContain(document.activeElement)
    } finally {
      overlay.remove()
    }
  })

  it('leaves a Tab alone that an earlier handler already prevented', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    outside.addEventListener('keydown', (e) => e.preventDefault())
    document.body.appendChild(outside)
    try {
      outside.focus()
      await pressTab(outside)
      expect(document.activeElement).toBe(outside)
      expect(items).not.toContain(document.activeElement)
    } finally {
      outside.remove()
    }
  })

  it('does not intercept Tab from a middle control (negative control)', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    expect(items.length).toBeGreaterThanOrEqual(3)
    const middle = items[Math.floor(items.length / 2)]
    middle.focus()
    const event = await pressTab(middle)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(middle)
  })

  it('generates a token and keeps the trap on the snippet step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ token: 'tok-abc123', name: 'test-agent' }),
      })),
    )
    const { container } = await openModal()
    const input = container.querySelector<HTMLInputElement>('#add-agent-name')!
    input.value = 'test-agent'
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await submitForm(container)
    // The modal focuses the token's Copy button one animation frame later.
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    })
    const items = controls(container.querySelector('[role="dialog"]')!)
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(document.activeElement).toBe(items[1]) // the token Copy button

    focusBody()
    const backEvent = await pressTab(document.body, true)
    expect(document.activeElement).toBe(items[items.length - 1]) // Done
    expect(backEvent.defaultPrevented).toBe(true)

    focusBody()
    const fwdEvent = await pressTab(document.body)
    expect(document.activeElement).toBe(items[0]) // Close
    expect(fwdEvent.defaultPrevented).toBe(true)
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const { container, opener } = await openModal()
    await key(window, 'Escape')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Cancel and returns focus to the opener', async () => {
    const { container, opener } = await openModal()
    const cancel = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!
    await click(cancel)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('AddAgentModal error announcement', () => {
  it('announces the empty-name error through a role=alert element', async () => {
    const { container } = await openModal()
    await submitForm(container)
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('Name is required')
  })

  it('remounts the alert on a repeated identical error so it is announced again', async () => {
    const { container } = await openModal()
    await submitForm(container)
    const first = container.querySelector('[role="alert"]')!
    expect(first.textContent).toContain('Name is required')
    await submitForm(container)
    const second = container.querySelector('[role="alert"]')!
    expect(second.textContent).toContain('Name is required')
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
  })

  it('shows the unusable-origin error through a role=alert element', async () => {
    // The component reads window.location.origin on every render
    // (originValid checks the http:// or https:// prefix), so an
    // origin without a usable scheme must surface the inline error.
    // jsdom's location object is replaced the same way as in
    // fetcher.test.ts and restored afterwards.
    const original = Object.getOwnPropertyDescriptor(window, 'location')!
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'not-a-url' },
    })
    try {
      const { container } = await openModal()
      const alert = container.querySelector('[role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert!.getAttribute('role')).toBe('alert')
      expect(alert!.textContent).toContain('Cannot determine the dashboard origin')
    } finally {
      Object.defineProperty(window, 'location', original)
    }
  })
})
