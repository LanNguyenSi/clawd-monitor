// @vitest-environment jsdom
/**
 * MetricsWidget non-text graphics contrast (WCAG 1.4.11). Every state of
 * the CPU sparkline and of the RAM bar renders a light-mode Tailwind
 * token plus a dark: partner (no inline hex stroke or fill left), and each
 * light token sits at 3:1 or above on the light card background. The card
 * background is the white `bg-white` card surface, measured in the browser
 * with `lane-browser get styles` as rgb(255, 255, 255).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const store = vi.hoisted(() => ({ data: undefined as unknown }))

vi.mock('@/lib/active-agent', () => ({
  useActiveAgent: () => ({ activeAgentId: 'a1', setActiveAgentId: () => {} }),
}))
vi.mock('swr', () => ({ default: () => ({ data: store.data, isLoading: false }) }))

import { MetricsWidget } from '@/components/widgets/MetricsWidget'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Palette values for the light tokens the widget may pick, and for the
// light card surface measured in the browser (bg-white = #ffffff).
const CARD = 'ffffff'
const TOKEN: Record<string, string> = {
  'red-700': 'b91c1c', 'yellow-800': '854d0e', 'green-700': '15803d',
  'red-500': 'ef4444', 'yellow-500': 'eab308', 'green-500': '22c55e',
  'red-400': 'f87171', 'yellow-400': 'facc15', 'green-400': '4ade80',
}
const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (fg: string, bg: string) => {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function snapshot(cpu: number, memPct: number) {
  return {
    online: true,
    snapshot: {
      metrics: { cpuPercent: cpu, memUsedBytes: memPct * 100, memTotalBytes: 10000 },
      timestamp: Date.now(),
    },
  }
}

let host: HTMLDivElement
let root: Root

async function render(cpu: number, memPct: number) {
  // Two distinct snapshot objects: the sparkline draws only from two
  // history points on, and the mocked hook re-renders per call.
  store.data = snapshot(cpu, memPct)
  await act(async () => { root.render(<MetricsWidget />) })
  store.data = snapshot(cpu, memPct)
  await act(async () => { root.render(<MetricsWidget />) })
}

const sparkline = () => host.querySelector<SVGElement>('svg polyline')!
const ramBar = () => Array.from(host.querySelectorAll('div')).find((d) => d.style.width !== '')!

/** Plain (non-variant) colour tokens of an element's class list. */
function lightTokens(cls: string): string[] {
  return cls.split(/\s+/).filter((t) => !t.includes(':')).map((t) => /(?:text|bg)-(.+)$/.exec(t)?.[1]).filter((k): k is string => !!k && !!TOKEN[k])
}

beforeEach(() => {
  store.data = undefined
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const STATES = [
  { name: 'ok', cpu: 50, memPct: 40, text: 'text-green-700', darkText: 'dark:text-green-400', bar: 'bg-green-700', darkBar: 'dark:bg-green-500' },
  { name: 'warning', cpu: 70, memPct: 65, text: 'text-yellow-800', darkText: 'dark:text-yellow-400', bar: 'bg-yellow-800', darkBar: 'dark:bg-yellow-500' },
  { name: 'critical', cpu: 85, memPct: 90, text: 'text-red-700', darkText: 'dark:text-red-400', bar: 'bg-red-700', darkBar: 'dark:bg-red-500' },
]

describe.each(STATES)('sparkline and RAM bar in the $name state', ({ cpu, memPct, text, darkText, bar, darkBar }) => {
  it('strokes the sparkline through currentColor with a light and a dark class, no inline hex, no inline opacity', async () => {
    await render(cpu, memPct)
    const line = sparkline()
    expect(line.getAttribute('stroke')).toBe('currentColor')
    const cls = line.getAttribute('class') ?? ''
    expect(cls).toContain(text)
    expect(cls).toContain(darkText)
    expect(cls).toContain('dark:opacity-70')
    expect([line.getAttribute('stroke') ?? '', line.getAttribute('fill') ?? ''].join(' ')).not.toMatch(/#[0-9a-f]/i)
    expect(line.getAttribute('opacity')).toBeNull()
  })

  it('fills the RAM bar with a light class and a dark: class, no inline hex', async () => {
    await render(cpu, memPct)
    const cls = ramBar().className
    expect(cls).toContain(bar)
    expect(cls).toContain(darkBar)
    expect(ramBar().getAttribute('style')).not.toMatch(/#[0-9a-f]/i)
  })

  it('keeps every light token at 3:1 or better on the white card', async () => {
    await render(cpu, memPct)
    const tokens = [...lightTokens(sparkline().getAttribute('class') ?? ''), ...lightTokens(ramBar().className)]
    expect(tokens.length).toBeGreaterThanOrEqual(2)
    for (const t of tokens) expect(ratio(TOKEN[t], CARD)).toBeGreaterThanOrEqual(3)
  })
})
