import { describe, it, expect } from 'vitest'
import { applyGridKey, breakpointAtWidth, widgetPassed, gridColsFor, isGridKey, layoutAtBreakpoint } from '@/lib/grid-keyboard'

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
    expect(r.message).toBe('A moved below b, column 1, row 3')
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

describe('applyGridKey with isUserAction semantics', () => {
  // Hand-derived from react-grid-layout 1.5.4 (moveElement, moveElementAwayFromCollision and
  // compact), 2 columns, ArrowDown on w1 (full width, 3 rows high at the top). One row and two
  // rows down are pulled straight back by compaction; at three rows down w1 overlaps w0 and w2.
  // As the main collision w2 may go up into the free space above w1 (the user-action rule), so
  // it lands at row 0 while w1 settles at row 3 and w0, w4, w3 are pushed down. With the flag off
  // w2 would instead be pushed below w1 and w0 would stay above it.
  const CASE = [
    { i: 'w0', x: 0, y: 3, w: 1, h: 4 },
    { i: 'w1', x: 0, y: 0, w: 2, h: 3 },
    { i: 'w2', x: 1, y: 3, w: 1, h: 3 },
    { i: 'w3', x: 0, y: 12, w: 2, h: 4 },
    { i: 'w4', x: 0, y: 7, w: 1, h: 5 },
  ]
  const spot = (layout: Array<{ i: string; x: number; y: number; w: number; h: number }>) =>
    Object.fromEntries(layout.map((l) => [l.i, [l.x, l.y, l.w, l.h]]))

  it('lets the widget in the way move up into the free space above, like a pointer drop', () => {
    const r = applyGridKey(CASE, 'w1', 'ArrowDown', false, 2, 'W1', (id) => id.toUpperCase())
    expect(r.changed).toBe(true)
    expect(spot(r.layout as typeof CASE)).toEqual({
      w0: [0, 6, 1, 4],
      w1: [0, 3, 2, 3],
      w2: [1, 0, 1, 3],
      w3: [0, 15, 2, 4],
      w4: [0, 10, 1, 5],
    })
    expect(r.message).toBe('W1 moved below W2, column 1, row 4')
  })
})

describe('what a grown step passed', () => {
  const titles: Record<string, string> = { a: 'Alpha', b: 'Beta', c: 'Gamma' }
  const titleOf = (id: string) => titles[id]

  it('names the widget a taller neighbour made the move skip', () => {
    const r = applyGridKey(L, 'a', 'ArrowDown', false, 4, 'Alpha', titleOf)
    // L: a above b, both one column wide and two rows high.
    expect(r.message).toBe('Alpha moved below Beta, column 1, row 3')
  })

  it('keeps the plain message for a one-cell move and when the passed widget is not clearly behind', () => {
    expect(applyGridKey(L, 'c', 'ArrowRight', false, 4, 'C', titleOf).message).toBe('C moved to column 3, row 1')
    expect(applyGridKey([{ i: 'a', x: 0, y: 0, w: 1, h: 1 }], 'a', 'ArrowRight', false, 4, 'Alpha', titleOf).message).toBe(
      'Alpha moved to column 2, row 1',
    )
  })

  it('keeps the plain message for a one-cell vertical move that pushes a widget away', () => {
    const lay = [
      { i: 'w0', x: 1, y: 1, w: 1, h: 3 },
      { i: 'w1', x: 0, y: 0, w: 1, h: 3 },
      { i: 'w2', x: 1, y: 0, w: 1, h: 1 },
    ]
    const r = applyGridKey(lay, 'w0', 'ArrowUp', false, 3, 'w0')
    expect(r.message).toBe('w0 moved to column 2, row 1')
  })

  it('says above for Up', () => {
    // Two-row widgets stacked: the lower one going Up skips the whole upper one.
    const stacked = [
      { i: 'a', x: 0, y: 0, w: 1, h: 2 },
      { i: 'b', x: 0, y: 2, w: 1, h: 2 },
    ]
    const up = applyGridKey(stacked, 'b', 'ArrowUp', false, 4, 'Beta', titleOf)
    expect(up.changed).toBe(true)
    expect(up.layout.find((l) => l.i === 'b')).toMatchObject({ x: 0, y: 0 })
    expect(up.message).toBe('Beta moved above Alpha, column 1, row 1')
  })
})

describe('widgetPassed', () => {
  // The widget that moved is m; a was beside its landing box and b is wholly on the
  // side it came from. Only b may be named, whatever order the layout lists them in.
  const start = { i: 'm', x: 0, y: 0, w: 1, h: 1 }
  const before = [
    start,
    { i: 'a', x: 0, y: 2, w: 1, h: 1 },
    { i: 'b', x: 0, y: 2, w: 1, h: 1 },
  ]
  it('skips an overlapped widget that did not end up behind the mover (down)', () => {
    const after = [
      { i: 'm', x: 0, y: 2, w: 1, h: 1 },
      { i: 'a', x: 0, y: 3, w: 1, h: 1 },
      { i: 'b', x: 0, y: 0, w: 1, h: 1 },
    ]
    expect(widgetPassed(before, after, start, 'ArrowDown', { x: 0, y: 2 }, after[0])).toEqual({ id: 'b', relation: 'below' })
  })

  it('skips an overlapped widget that did not end up behind the mover (up)', () => {
    const up = { i: 'm', x: 0, y: 4, w: 1, h: 1 }
    const after = [
      { i: 'm', x: 0, y: 2, w: 1, h: 1 },
      { i: 'a', x: 0, y: 1, w: 1, h: 1 },
      { i: 'b', x: 0, y: 3, w: 1, h: 1 },
    ]
    expect(widgetPassed([up, before[1], before[2]], after, up, 'ArrowUp', { x: 0, y: 2 }, after[0])).toEqual({ id: 'b', relation: 'above' })
  })

  it('names nothing when no overlapped widget is behind the mover, and for sideways keys', () => {
    const after = [
      { i: 'm', x: 0, y: 2, w: 1, h: 1 },
      { i: 'a', x: 0, y: 3, w: 1, h: 1 },
      { i: 'b', x: 0, y: 4, w: 1, h: 1 },
    ]
    expect(widgetPassed(before, after, start, 'ArrowDown', { x: 0, y: 2 }, after[0])).toBeNull()
    expect(widgetPassed(before, after, start, 'ArrowRight', { x: 0, y: 2 }, after[0])).toBeNull()
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
