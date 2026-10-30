// @vitest-environment jsdom
/**
 * SessionLogWidget picks the first session as its default selection and keeps
 * a session the user chose when the snapshot refreshes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const h = vi.hoisted(() => ({
  data: undefined as unknown,
}))

vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: 'a1', setActiveAgentId: () => {} }),
}))
vi.mock('swr', () => ({ default: () => ({ data: h.data }) }))

import { SessionLogWidget } from '@/components/widgets/SessionLogWidget'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function snapshot(keys: string[]) {
  return {
    online: true,
    snapshot: { sessions: keys.map((k) => ({ sessionKey: k, messageCount: 1, recentMessages: [{ role: 'user', content: `msg-${k}` }] })) },
  }
}

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => { root.render(<SessionLogWidget />) })
}

const select = () => host.querySelector('select[aria-label="Session"]') as HTMLSelectElement

beforeEach(() => {
  h.data = undefined
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('SessionLogWidget default selection', () => {
  it('selects the first session once the snapshot arrives', async () => {
    await render()
    expect(select().value).toBe('')
    h.data = snapshot(['agent:main:aaaa', 'agent:main:bbbb'])
    await render()
    expect(select().value).toBe('agent:main:aaaa')
    expect(host.textContent).toContain('msg-agent:main:aaaa')
    expect(host.textContent).not.toContain('msg-agent:main:bbbb')
  })

  it('keeps the session the user chose across snapshot refreshes', async () => {
    h.data = snapshot(['agent:main:aaaa', 'agent:main:bbbb'])
    await render()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select(), 'agent:main:bbbb')
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.textContent).toContain('msg-agent:main:bbbb')
    h.data = snapshot(['agent:main:aaaa', 'agent:main:bbbb'])
    await render()
    expect(select().value).toBe('agent:main:bbbb')
    expect(host.textContent).toContain('msg-agent:main:bbbb')
    expect(host.textContent).not.toContain('msg-agent:main:aaaa')
  })
})
