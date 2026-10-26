/**
 * Minimal jsdom render helpers (the repo has no component test framework).
 * Only imported by tests that run under `// @vitest-environment jsdom`.
 */
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export interface Mounted {
  container: HTMLElement
  unmount: () => void
}

const mounted: Mounted[] = []

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
  const handle: Mounted = {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
  mounted.push(handle)
  return handle
}

export function unmountAll(): void {
  while (mounted.length) mounted.pop()!.unmount()
}

/** Let pending promises (mocked fetch, effects that await it) settle. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function key(target: Element | Document | Window, k: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

export { createElement }
