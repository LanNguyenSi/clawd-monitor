'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * Shared open/close and keyboard behaviour for the navbar dropdown menus
 * (agent switcher, widget picker, user menu).
 *
 * - The trigger announces the popup (aria-haspopup, aria-expanded,
 *   aria-controls while open).
 * - Opening moves focus to the first menu item; Arrow Up/Down, Home and End
 *   move between items (wrapping), Escape and Tab close the menu.
 * - Every close path (Escape, item activation, backdrop click) hands focus
 *   back to the trigger, so keyboard users do not lose their place when the
 *   focused item unmounts.
 *
 * Items must carry role="menuitem"; the key handler goes on an element that
 * contains both the trigger and the menu.
 */
export function useMenuA11y() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key === 'Tab') {
        // Leave the popup; the browser then moves focus on from the trigger.
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      )
      if (items.length === 0) return
      e.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLElement)
      let next = 0
      if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
      else if (e.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
      else if (e.key === 'End') next = items.length - 1
      items[next].focus()
    },
    [open, close],
  )

  return {
    open,
    toggle,
    close,
    onKeyDown,
    triggerProps: {
      ref: triggerRef,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      'aria-controls': open ? menuId : undefined,
      onClick: toggle,
    },
    menuProps: {
      ref: menuRef,
      id: menuId,
      role: 'menu' as const,
    },
  }
}
