// @vitest-environment jsdom
/**
 * Status dots carry their state as text for assistive tech (the dot itself is
 * decorative), and the header controls of the Memory, Session Log and Log Tail
 * widgets reach the 24px minimum target.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const h = vi.hoisted(() => ({ agentId: null as string | null, data: undefined as unknown }))

vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: h.agentId, setActiveAgentId: () => {} }),
}))
vi.mock('swr', () => ({
  default: () => ({ data: h.data, isLoading: false, mutate: () => {} }),
}))

import { DockerWidget } from '@/components/widgets/DockerWidget'
import { CronWidget } from '@/components/widgets/CronWidget'
import { MemoryWidget } from '@/components/widgets/MemoryWidget'
import { SessionLogWidget } from '@/components/widgets/SessionLogWidget'
import { LogTailWidget } from '@/components/widgets/LogTailWidget'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  close() {}
}

let host: HTMLDivElement
let root: Root

async function render(el: React.ReactElement) {
  await act(async () => { root.render(el) })
}

beforeEach(() => {
  h.agentId = null
  h.data = undefined
  vi.stubGlobal('EventSource', FakeEventSource)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

/** The dot is the aria-hidden sibling that precedes the sr-only state text. */
function dotAndText(label: string): { dot: Element; text: Element | null }[] {
  const region = host.querySelector(`[aria-label="${label}"]`)!
  return Array.from(region.querySelectorAll('.rounded-full')).map((dot) => ({
    dot,
    text: dot.nextElementSibling?.classList.contains('sr-only') ? dot.nextElementSibling : null,
  }))
}

describe('Docker state text', () => {
  it('exposes each container state as sr-only text and hides the dot', async () => {
    h.data = {
      containers: [
        { id: '1', name: 'web', image: 'web:1', state: 'running', uptime: '1h' },
        { id: '2', name: 'db', image: 'db:1', state: 'exited', uptime: '1h' },
        { id: '3', name: 'odd', image: 'odd:1', state: 'bogus', uptime: '1h' },
      ],
    }
    await render(<DockerWidget />)
    const rows = dotAndText('Docker containers')
    expect(rows.map((r) => r.text?.textContent)).toEqual(['running', 'exited', 'unknown'])
    for (const r of rows) expect(r.dot.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Cron state text', () => {
  it('exposes enabled and disabled as sr-only text and hides the dot', async () => {
    h.data = {
      jobs: [
        { id: 'job-one-aaaa', name: 'on', enabled: true, schedule: { kind: 'cron', expr: '* * * * *' } },
        { id: 'job-two-bbbb', name: 'off', enabled: false, schedule: { kind: 'cron', expr: '* * * * *' } },
      ],
    }
    await render(<CronWidget />)
    const rows = dotAndText('Cron jobs')
    expect(rows.map((r) => r.text?.textContent)).toEqual(['enabled', 'disabled'])
    for (const r of rows) expect(r.dot.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('header controls keep a 24px minimum target', () => {
  const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

  it('Memory: select and refresh button', async () => {
    h.data = { content: 'hello', updatedAt: new Date().toISOString() }
    await render(<MemoryWidget />)
    expect(classes(host.querySelector('select[aria-label="Memory file"]'))).toContain('min-h-6')
    const refresh = classes(host.querySelector('button[title="Refresh"]'))
    expect(refresh).toContain('min-h-6')
    expect(refresh).toContain('min-w-6')
  })

  it('Session Log: select and auto-scroll toggle', async () => {
    h.agentId = 'a1'
    h.data = { online: true, snapshot: { sessions: [{ sessionKey: 'agent:main:aaaa', recentMessages: [] }] } }
    await render(<SessionLogWidget />)
    expect(classes(host.querySelector('select[aria-label="Session"]'))).toContain('min-h-6')
    const toggle = classes(host.querySelector('button[title="Toggle auto-scroll"]'))
    expect(toggle).toContain('min-h-6')
    expect(toggle).toContain('min-w-6')
  })

  it('Log Tail: source select, container select and auto toggle', async () => {
    h.data = { containers: ['web'] }
    await render(<LogTailWidget />)
    const source = host.querySelector('select[aria-label="Log source"]') as HTMLSelectElement
    expect(classes(source)).toContain('min-h-6')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(source, 'docker')
      source.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(classes(host.querySelector('select[aria-label="Docker container"]'))).toContain('min-h-6')
    const auto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('auto'))!
    expect(classes(auto)).toContain('min-h-6')
  })
})
