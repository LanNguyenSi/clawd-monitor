// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { LAYOUT_STORAGE_KEY } from '@/lib/layout-storage'

// Real react-grid-layout (its compaction decides where a restored widget
// lands); only the width measurement is replaced.
vi.mock('react-grid-layout', async () => {
  const React = await import('react')
  const actual = await vi.importActual<typeof import('react-grid-layout')>('react-grid-layout')
  return {
    ...actual,
    WidthProvider: (C: React.ComponentType<Record<string, unknown>>) =>
      function Fixed(p: Record<string, unknown>) {
        return React.createElement(C, { ...p, width: 1280 })
      },
  }
})
vi.mock('@/components/widgets/MetricsWidget', () => ({ MetricsWidget: () => null }))
vi.mock('@/components/widgets/CronWidget', () => ({ CronWidget: () => null }))
vi.mock('@/components/widgets/HeartbeatWidget', () => ({ HeartbeatWidget: () => null }))

import { WidgetGrid } from '@/components/Grid/WidgetGrid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it('Undo puts a widget back at its old position even when the widget below moved up', async () => {
  localStorage.clear()
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({
      lg: [
        { i: 'metrics', x: 0, y: 0, w: 1, h: 2 },
        { i: 'cron', x: 1, y: 0, w: 2, h: 2 },
        { i: 'heartbeat', x: 0, y: 2, w: 1, h: 1 },
      ],
    }),
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<WidgetGrid cols={4} editMode />))
  await act(async () => {})
  const pos = () =>
    Object.fromEntries(
      JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).lg.map((l: { i: string; x: number; y: number }) => [l.i, [l.x, l.y]]),
    )

  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove CPU + RAM widget"]')!.click())
  await act(async () => {})
  expect(pos().heartbeat).toEqual([0, 0])

  const undo = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!
  await act(async () => undo.click())
  await act(async () => {})
  expect(pos()).toEqual({ metrics: [0, 0], cron: [1, 0], heartbeat: [0, 2] })
})
