// @vitest-environment jsdom
/**
 * LogTailWidget offers only the sources the selected agent's route can serve:
 * with an agent selected that is OpenClaw alone (docker and system would be the
 * dashboard host's logs), without one all three.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const h = vi.hoisted(() => ({ agentId: null as string | null, urls: [] as string[] }))

vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: h.agentId, setActiveAgentId: () => {} }),
}))
vi.mock('swr', () => ({ default: () => ({ data: { containers: ['web'] } }) }))

import { LogTailWidget } from '@/components/widgets/LogTailWidget'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(url: string) { h.urls.push(url) }
  close() {}
}

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => { root.render(<LogTailWidget />) })
}

const select = () => host.querySelector('select[aria-label="Log source"]') as HTMLSelectElement
const optionValues = () => Array.from(select().options).map((o) => o.value)

async function choose(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(select(), value)
    select().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  h.agentId = null
  h.urls = []
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

describe('LogTailWidget sources', () => {
  it('offers openclaw, docker and system without an agent', async () => {
    await render()
    expect(optionValues()).toEqual(['openclaw', 'docker', 'system'])
  })

  it('offers only openclaw with an agent selected', async () => {
    h.agentId = 'a1'
    await render()
    expect(optionValues()).toEqual(['openclaw'])
    expect(h.urls).toEqual(['/api/agents/a1/logs?source=openclaw'])
  })

  it('does not carry a system choice over to an agent, and restores it without one', async () => {
    await render()
    await choose('system')
    expect(h.urls.at(-1)).toBe('/api/stream/logs?source=system')

    h.agentId = 'a1'
    await render()
    expect(optionValues()).toEqual(['openclaw'])
    expect(select().value).toBe('openclaw')
    expect(h.urls.at(-1)).toBe('/api/agents/a1/logs?source=openclaw')
    expect(h.urls.some((u) => u.startsWith('/api/agents/') && u.includes('source=system'))).toBe(false)

    h.agentId = null
    await render()
    expect(optionValues()).toEqual(['openclaw', 'docker', 'system'])
    expect(select().value).toBe('system')
  })

  it('does not carry a docker choice over to an agent', async () => {
    await render()
    await choose('docker')
    h.agentId = 'a1'
    await render()
    expect(h.urls.filter((u) => u.startsWith('/api/agents/'))).toEqual(['/api/agents/a1/logs?source=openclaw'])
    expect(host.querySelector('select[aria-label="Docker container"]')).toBeNull()
  })
})
