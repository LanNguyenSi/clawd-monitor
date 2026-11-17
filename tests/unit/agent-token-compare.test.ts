import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<[string, string]> = []
vi.mock('@/lib/secure-compare', async () => {
  const actual = await vi.importActual<typeof import('@/lib/secure-compare')>('@/lib/secure-compare')
  return {
    safeEqual: (a: string, b: string) => {
      calls.push([a, b])
      return actual.safeEqual(a, b)
    },
  }
})

import { matchesStaticToken } from '@/lib/agent-ws-handler'

const TOKENS = ['alpha-token', 'bravo-token', 'charlie-token']

describe('matchesStaticToken', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('matches a configured token', () => {
    expect(matchesStaticToken('bravo-token', TOKENS)).toBe(true)
  })

  it('does not match an unknown token of the same length', () => {
    expect(matchesStaticToken('delta-token', TOKENS)).toBe(false)
  })

  it('does not match a token of a different length or a prefix of one', () => {
    expect(matchesStaticToken('alpha-token-and-more', TOKENS)).toBe(false)
    expect(matchesStaticToken('alpha', TOKENS)).toBe(false)
  })

  it('never matches when no static token is configured', () => {
    expect(matchesStaticToken('alpha-token', [])).toBe(false)
    expect(matchesStaticToken('', [])).toBe(false)
  })

  it('does not match an empty presented token', () => {
    expect(matchesStaticToken('', TOKENS)).toBe(false)
  })

  it('treats a non-string token as no match without comparing', () => {
    expect(matchesStaticToken(undefined, TOKENS)).toBe(false)
    expect(matchesStaticToken(null, TOKENS)).toBe(false)
    expect(matchesStaticToken(42, TOKENS)).toBe(false)
    expect(matchesStaticToken(['alpha-token'], TOKENS)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('compares against every configured token even when the first one matches', () => {
    expect(matchesStaticToken('alpha-token', TOKENS)).toBe(true)
    expect(calls).toHaveLength(TOKENS.length)
    expect(calls.map(([, t]) => t)).toEqual(TOKENS)
  })

  it('does the same number of comparisons for a match, a late match and a miss', () => {
    matchesStaticToken('alpha-token', TOKENS)
    const first = calls.length
    calls.length = 0
    matchesStaticToken('charlie-token', TOKENS)
    const last = calls.length
    calls.length = 0
    matchesStaticToken('nope', TOKENS)
    expect([first, last, calls.length]).toEqual([3, 3, 3])
  })
})
