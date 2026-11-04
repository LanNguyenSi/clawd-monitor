import { describe, it, expect } from 'vitest'
import { safeEqual } from '@/lib/secure-compare'

describe('safeEqual', () => {
  it('is true for equal strings', () => {
    expect(safeEqual('hunter2', 'hunter2')).toBe(true)
  })

  it('is true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
  })

  it('is false for different strings of the same length', () => {
    expect(safeEqual('hunter2', 'hunter3')).toBe(false)
  })

  it('is false, and does not throw, when the lengths differ', () => {
    expect(safeEqual('hunter2', 'hunter22')).toBe(false)
    expect(safeEqual('hunter22', 'hunter2')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
  })

  it('is false for a prefix of the secret', () => {
    expect(safeEqual('hun', 'hunter2')).toBe(false)
  })

  it('compares multi-byte characters by their bytes', () => {
    expect(safeEqual('pässword', 'pässword')).toBe(true)
    expect(safeEqual('pässword', 'passwörd')).toBe(false)
  })
})
