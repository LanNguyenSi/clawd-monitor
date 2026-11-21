import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'

const headerValues = vi.hoisted(() => ({ nonce: 'nonce-from-middleware' as string | null }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerValues.nonce === null ? {} : { 'x-nonce': headerValues.nonce }),
}))
vi.mock('next/font/local', () => ({
  default: () => ({ className: 'font-stub', variable: 'font-var' }),
}))

import RootLayout from '@/app/layout'

type El = ReactElement<{ children?: unknown; nonce?: string; dangerouslySetInnerHTML?: { __html: string } }>
function findScript(node: unknown): El | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findScript(n)
      if (f) return f
    }
    return null
  }
  const el = node as El
  if (el.type === 'script') return el
  return findScript(el.props?.children)
}

describe('root layout theme script', () => {
  it('carries the per-request nonce from the x-nonce header', async () => {
    headerValues.nonce = 'nonce-from-middleware'
    const script = findScript(await RootLayout({ children: null }))
    expect(script?.props.nonce).toBe('nonce-from-middleware')
    expect(script?.props.dangerouslySetInnerHTML?.__html).toContain('clawd-monitor:theme')
  })

  it('renders the script without a nonce when the header is absent', async () => {
    headerValues.nonce = null
    const script = findScript(await RootLayout({ children: null }))
    expect(script?.props.nonce).toBeUndefined()
    expect(script?.props.dangerouslySetInnerHTML?.__html).toContain('clawd-monitor:theme')
  })
})
