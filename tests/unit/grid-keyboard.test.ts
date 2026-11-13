import { describe, it, expect } from 'vitest'
import { applyGridKey, breakpointAtWidth, gridColsFor, isGridKey, layoutAtBreakpoint } from '@/lib/grid-keyboard'

const L = [
  { i: 'a', x: 0, y: 0, w: 1, h: 2 },
  { i: 'b', x: 0, y: 2, w: 1, h: 2 },
  { i: 'c', x: 1, y: 0, w: 2, h: 1 },
]
const at = (layout: typeof L, id: string) => layout.find((l) => l.i === id)!

describe('applyGridKey', () => {
  it('does not modify its input and returns the same array when nothing changed', () => {
    const copy = JSON.parse(JSON.stringify(L))
    const moved = applyGridKey(L, 'c', 'ArrowRight', false, 4, 'C')
    expect(moved.changed).toBe(true)
    expect(L).toEqual(copy)
    const blocked = applyGridKey(L, 'a', 'ArrowLeft', false, 4, 'A')
    expect(blocked.changed).toBe(false)
    expect(blocked.layout).toBe(L)
  })

  it('returns an empty message for an unknown id', () => {
    expect(applyGridKey(L, 'zzz', 'ArrowLeft', false, 4, 'Z')).toEqual({ layout: L, changed: false, message: '' })
  })

  it('grows the step when one row down is pulled straight back by compaction', () => {
    // a is two rows high and b (also two rows) sits right below it.
    const r = applyGridKey(L, 'a', 'ArrowDown', false, 4, 'A')
    expect(r.changed).toBe(true)
    expect(at(r.layout as typeof L, 'a')).toMatchObject({ x: 0, y: 2 })
    expect(at(r.layout as typeof L, 'b')).toMatchObject({ x: 0, y: 0 })
    expect(r.message).toBe('A moved to column 1, row 3')
  })

  it('reports the bottom when nothing is below', () => {
    const r = applyGridKey(L, 'b', 'ArrowDown', false, 4, 'B')
    expect(r.changed).toBe(false)
    expect(r.message).toBe('B: cannot move down, already at the bottom')
  })

  it('clamps a move to the columns that exist for the widget width', () => {
    const r = applyGridKey(L, 'c', 'ArrowRight', false, 4, 'C')
    expect(at(r.layout as typeof L, 'c')).toMatchObject({ x: 2, w: 2 })
    expect(applyGridKey(r.layout as typeof L, 'c', 'ArrowRight', false, 4, 'C').changed).toBe(false)
    // Narrower grid: c (w 2) at x 1 has no room to the right in 3 columns.
    expect(applyGridKey(L, 'c', 'ArrowRight', false, 3, 'C').changed).toBe(false)
  })

  it('resizes with min, max and column bounds', () => {
    const lay = [{ i: 'a', x: 1, y: 0, w: 2, h: 2, minW: 2, maxW: 3, minH: 2, maxH: 3 }]
    expect(applyGridKey(lay, 'a', 'ArrowLeft', true, 4, 'A').changed).toBe(false)
    expect(applyGridKey(lay, 'a', 'ArrowUp', true, 4, 'A').changed).toBe(false)
    const wider = applyGridKey(lay, 'a', 'ArrowRight', true, 4, 'A')
    expect(wider.message).toBe('A resized to 3 by 2')
    expect(applyGridKey(wider.layout as typeof lay, 'a', 'ArrowRight', true, 4, 'A').changed).toBe(false)
    const taller = applyGridKey(lay, 'a', 'ArrowDown', true, 4, 'A')
    expect(taller.message).toBe('A resized to 2 by 3')
    expect(applyGridKey(taller.layout as typeof lay, 'a', 'ArrowDown', true, 4, 'A').changed).toBe(false)
    // Column bound beats maxW: x 1 + w 3 would be 4 columns, only 3 exist.
    expect(applyGridKey(lay, 'a', 'ArrowRight', true, 3, 'A').changed).toBe(false)
  })
})

describe('grid helpers', () => {
  it('knows the four arrows only', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].every(isGridKey)).toBe(true)
    expect(['Home', 'a', 'Tab', 'Escape'].some(isGridKey)).toBe(false)
  })

  it('maps a width to a breakpoint, an unmeasured width to lg', () => {
    expect(breakpointAtWidth(1201)).toBe('lg')
    expect(breakpointAtWidth(1200)).toBe('md')
    expect(breakpointAtWidth(400)).toBe('xs')
    expect(breakpointAtWidth(100)).toBe('xxs')
    expect(breakpointAtWidth(0)).toBe('lg')
  })

  it('derives columns per breakpoint from the base count', () => {
    expect(gridColsFor(8)).toEqual({ lg: 8, md: 4, sm: 2, xs: 1, xxs: 1 })
    expect(gridColsFor(2)).toEqual({ lg: 2, md: 2, sm: 2, xs: 1, xxs: 1 })
  })

  it('generates a layout for a breakpoint that has none from the nearest wider one', () => {
    const generated = layoutAtBreakpoint({ lg: L }, 'xxs', 1)
    expect(generated.map((l) => l.i).sort()).toEqual(['a', 'b', 'c'])
    expect(generated.every((l) => l.x === 0 && l.w === 1)).toBe(true)
  })
})
