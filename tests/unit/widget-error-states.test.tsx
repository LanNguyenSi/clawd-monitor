// @vitest-environment jsdom
/**
 * Gateway-error state of AgentStatusWidget and CronWidget: a failed
 * gateway request surfaces as the neutral sentence "Gateway request
 * failed." (neutral because the failure may be an unreachable
 * gateway, a gateway that answered with an error, or a request
 * refused by the URL policy) in the HeartbeatWidget error look
 * (text-red-700 dark:text-red-400) inside a role="status" element,
 * with the raw transport message kept as a secondary detail line (not
 * the only content, and not duplicated in a title attribute).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: null, setActiveAgentId: () => {} }),
}))

import { AgentStatusWidget } from '@/components/widgets/AgentStatusWidget'
import { CronWidget } from '@/components/widgets/CronWidget'
import type { ReactElement } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The proxy routes answer a failed gateway fetch with HTTP 200 and the
// raw message in the JSON `error` field; that is what reaches the widget.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...(String(url).includes('/proxy/cron') ? { jobs: [] } : { sessions: [] }),
        error: 'fetch failed',
      }),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function mountUntilError(element: ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(element) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  mounted.push({ host, root })
  return host
}

const mounted: { host: HTMLDivElement; root: Root }[] = []

afterEach(() => {
  while (mounted.length) {
    const { host, root } = mounted.pop()!
    act(() => root.unmount())
    host.remove()
  }
})

for (const widget of [
  { name: 'AgentStatusWidget', element: () => <AgentStatusWidget /> },
  { name: 'CronWidget', element: () => <CronWidget /> },
]) {
  describe(`${widget.name} gateway error`, () => {
    it('shows the readable sentence in the error style with role=status on a rejected fetch', async () => {
      const host = await mountUntilError(widget.element())
      const status = host.querySelector('[role="status"]')
      expect(status).not.toBeNull()
      expect(status!.textContent).toContain('Gateway request failed.')
      expect(status!.className).toContain('text-red-700')
      expect(status!.className).toContain('dark:text-red-400')
    })

    it('keeps the raw message as a secondary detail, not the only visible text', async () => {
      const host = await mountUntilError(widget.element())
      const status = host.querySelector('[role="status"]')!
      const block = status.parentElement!
      expect(block.textContent).toContain('fetch failed')
      expect(block.textContent).toContain('Gateway request failed.')
      const detail = Array.from(block.querySelectorAll('p')).find((p) => p.textContent === 'fetch failed')
      expect(detail).toBeDefined()
      expect(detail!.textContent).toBe('fetch failed')
      // The visible text already is the full message; no title copy.
      expect(detail!.hasAttribute('title')).toBe(false)
      expect(status!.textContent).not.toContain('fetch failed')
    })
  })
}
