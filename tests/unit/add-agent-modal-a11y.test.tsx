// @vitest-environment jsdom
/**
 * AddAgentModal focus management and error announcement (WCAG 2.4.3 / 4.1.3):
 * Tab and Shift+Tab wrap inside the dialog instead of reaching the page
 * behind it, Escape and Cancel hand focus back to the opener, and a
 * validation error is announced through a role="alert" element.
 */
import { describe, it, expect, afterEach } from 'vitest'
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

async function pressTab(el: HTMLElement, shift = false) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  unmountAll()
  document.body.innerHTML = ''
})

describe('AddAgentModal focus trap', () => {
  it('is a modal dialog named by its heading and focuses the name field on open', async () => {
    const { container } = await openModal()
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toContain('Add Agent')
    expect(document.activeElement).toBe(container.querySelector<HTMLInputElement>('#add-agent-name'))
  })

  it('wraps Tab from the last control back to the first', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    expect(items.length).toBeGreaterThanOrEqual(2)
    items[items.length - 1].focus()
    await pressTab(items[items.length - 1])
    expect(document.activeElement).toBe(items[0])
  })

  it('wraps Shift+Tab from the first control back to the last', async () => {
    const { container } = await openModal()
    const items = controls(container.querySelector('[role="dialog"]')!)
    items[0].focus()
    await pressTab(items[0], true)
    expect(document.activeElement).toBe(items[items.length - 1])
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
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('Name is required')
  })
})
