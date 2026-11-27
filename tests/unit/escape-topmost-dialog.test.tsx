// @vitest-environment jsdom
/**
 * Escape closes only the topmost dialog: with the shortcuts overlay open
 * above the Add agent modal, one Escape closes the overlay and hands focus
 * back to the modal control that had it, a second Escape closes the modal.
 * Both window listeners are registered in either order (the overlay
 * re-registers its listener whenever its callbacks or its open state
 * change, so its position relative to the modal's is not fixed).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { act } from 'react'
import { mount, unmountAll, key, createElement as h } from './dom-helpers'
import { AddAgentModal } from '@/components/AddAgentModal'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'

const noop = () => {}

function Modal() {
  const [open, setOpen] = useState(true)
  return h(AddAgentModal, { open, onClose: () => setOpen(false) })
}

const overlayEl = (props: { onToggleTheme?: () => void } = {}) =>
  h(KeyboardShortcuts, { onRefresh: noop, onToggleTheme: props.onToggleTheme ?? noop, onToggleEditMode: noop })

const modalOpen = () => document.querySelector('#add-agent-title')
const dialogs = () => Array.from(document.querySelectorAll('[aria-modal="true"]'))

async function settle() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  })
}

async function pressEscape(): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => {
    document.activeElement?.dispatchEvent(event)
  })
  return event
}

/** Modal first, then overlay: the overlay's listener is registered last. */
async function modalThenOverlay() {
  await mount(h(Modal))
  await settle()
  await mount(overlayEl())
}

/** Overlay first, then modal: the modal's listener is registered last. */
async function overlayThenModal() {
  await mount(overlayEl())
  await mount(h(Modal))
  await settle()
}

/** Focus a non-text control of the modal and open the overlay with `?`. */
async function openOverlayOverModal() {
  const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Cancel')!
  cancel.focus()
  await key(cancel, '?')
  return cancel
}

afterEach(() => {
  unmountAll()
  document.body.innerHTML = ''
})

describe.each([
  ['modal registered first, overlay last', modalThenOverlay],
  ['overlay registered first, modal last', overlayThenModal],
])('overlay above the modal (%s)', (_name, setup) => {
  it('first Escape closes only the overlay and focus returns to the modal control; second Escape closes the modal', async () => {
    await setup()
    const cancel = await openOverlayOverModal()
    expect(dialogs()).toHaveLength(2)

    const first = await pressEscape()
    expect(first.defaultPrevented).toBe(true)
    expect(dialogs()).toHaveLength(1)
    expect(document.activeElement).toBe(cancel)

    const second = await pressEscape()
    expect(second.defaultPrevented).toBe(false)
    expect(dialogs()).toHaveLength(0)
  })
})

describe('single dialog', () => {
  it('Escape with only the overlay open closes it and leaves a closed-help Escape untouched', async () => {
    await mount(overlayEl())
    const closedEscape = await pressEscape()
    expect(closedEscape.defaultPrevented).toBe(false)
    await key(window, '?')
    expect(dialogs()).toHaveLength(1)
    const openEscape = await pressEscape()
    expect(openEscape.defaultPrevented).toBe(true)
    expect(dialogs()).toHaveLength(0)
  })

  it('Escape with only the modal open (name step) closes it and is not consumed', async () => {
    await mount(overlayEl())
    await mount(h(Modal))
    await settle()
    expect(dialogs()).toHaveLength(1)
    const e = await pressEscape()
    expect(e.defaultPrevented).toBe(false)
    expect(dialogs()).toHaveLength(0)
  })
})

describe('an Escape another handler already took', () => {
  it('does not close the modal even when focus sits inside it', async () => {
    const consume = (e: KeyboardEvent) => e.preventDefault()
    // Registered before the modal mounts, so it runs first (overlay-first order).
    window.addEventListener('keydown', consume)
    try {
      await mount(h(Modal))
      await settle()
      expect(dialogs()).toHaveLength(1)
      const e = await pressEscape()
      expect(e.defaultPrevented).toBe(true)
      expect(dialogs()).toHaveLength(1)
    } finally {
      window.removeEventListener('keydown', consume)
    }
  })
})

describe('modal alone', () => {
  it('closes on Escape without the overlay mounted', async () => {
    await mount(h(Modal))
    await settle()
    await pressEscape()
    expect(modalOpen()).toBeNull()
  })
})
