import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LoginRateLimiter } from '@/lib/login-rate-limit'

const WINDOW = 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('attempt budget', () => {
  it('admits exactly `max` attempts, then refuses', () => {
    const l = new LoginRateLimiter(3, WINDOW, 100)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(false)
    expect(l.acquire('a').allowed).toBe(false)
  })

  it('counts attempts per key', () => {
    const l = new LoginRateLimiter(1, WINDOW, 100)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(false)
    expect(l.acquire('b').allowed).toBe(true)
  })

  it('reports the seconds left in the window, rounded up and at least 1', () => {
    const l = new LoginRateLimiter(1, 10_000, 100)
    l.acquire('a')
    expect(l.acquire('a')).toEqual({ allowed: false, retryAfterSeconds: 10 })
    vi.advanceTimersByTime(2_500)
    expect(l.acquire('a')).toEqual({ allowed: false, retryAfterSeconds: 8 })
    vi.advanceTimersByTime(7_499)
    expect(l.acquire('a')).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })

  it('does not extend the lockout by refused attempts', () => {
    const l = new LoginRateLimiter(1, WINDOW, 100)
    l.acquire('a')
    vi.advanceTimersByTime(WINDOW - 1)
    expect(l.acquire('a').allowed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(l.acquire('a').allowed).toBe(true)
  })
})

describe('reset', () => {
  it('a reset gives the key a fresh budget', () => {
    const l = new LoginRateLimiter(2, WINDOW, 100)
    l.acquire('a')
    l.acquire('a')
    expect(l.acquire('a').allowed).toBe(false)
    l.reset('a')
    expect(l.size).toBe(0)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(false)
  })

  it('does not touch other keys', () => {
    const l = new LoginRateLimiter(1, WINDOW, 100)
    l.acquire('a')
    l.acquire('b')
    l.reset('a')
    expect(l.acquire('b').allowed).toBe(false)
  })

  it('is a no-op for an unknown key', () => {
    const l = new LoginRateLimiter(1, WINDOW, 100)
    expect(() => l.reset('nobody')).not.toThrow()
  })
})

describe('window expiry', () => {
  it('forgets a key when its window has passed', () => {
    const l = new LoginRateLimiter(2, WINDOW, 100)
    l.acquire('a')
    l.acquire('a')
    vi.advanceTimersByTime(WINDOW - 1)
    expect(l.acquire('a').allowed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(false)
  })

  it('a partly used window also ends at the first attempt plus the window', () => {
    const l = new LoginRateLimiter(2, WINDOW, 100)
    l.acquire('a')
    vi.advanceTimersByTime(WINDOW)
    // new window: two fresh attempts, not one
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a').allowed).toBe(false)
  })
})

describe('memory bound', () => {
  // Spends `n` attempts on `key`.
  const hit = (l: LoginRateLimiter, key: string, n = 1) => {
    for (let i = 0; i < n; i++) l.acquire(key)
  }

  it('never holds more than maxKeys entries', () => {
    const l = new LoginRateLimiter(5, WINDOW, 3)
    for (let i = 0; i < 50; i++) l.acquire(`k${i}`)
    expect(l.size).toBe(3)
  })

  it('purges expired entries at the cap, so live keys keep their count', () => {
    const l = new LoginRateLimiter(5, WINDOW, 3)
    hit(l, 'old1')
    hit(l, 'old2')
    vi.advanceTimersByTime(WINDOW)
    hit(l, 'live', 4)
    expect(l.size).toBe(3) // expired entries still count until a new key needs room
    hit(l, 'b') // at the cap: old1 and old2 are purged, nothing live is evicted
    expect(l.size).toBe(2)
    hit(l, 'c')
    expect(l.size).toBe(3)
    expect(l.acquire('live').allowed).toBe(true) // 5th attempt
    expect(l.acquire('live').allowed).toBe(false)
  })

  it('at the cap evicts the entry with the fewest attempts', () => {
    const l = new LoginRateLimiter(5, WINDOW, 3)
    hit(l, 'three', 3)
    hit(l, 'two', 2)
    hit(l, 'one')
    hit(l, 'new') // evicts 'one'
    expect(l.size).toBe(3)
    expect(l.acquire('three').allowed).toBe(true)
    expect(l.acquire('three').allowed).toBe(true)
    expect(l.acquire('three').allowed).toBe(false)
    for (let i = 0; i < 3; i++) expect(l.acquire('two').allowed).toBe(true)
    expect(l.acquire('two').allowed).toBe(false)
  })

  it('on equal attempts evicts the oldest window first', () => {
    const l = new LoginRateLimiter(2, WINDOW, 2)
    hit(l, 'older')
    vi.advanceTimersByTime(10)
    hit(l, 'newer')
    hit(l, 'incoming') // evicts 'older'
    // 'newer' kept its attempt, so only one more is admitted
    expect(l.acquire('newer').allowed).toBe(true)
    expect(l.acquire('newer').allowed).toBe(false)
    // 'older' was dropped, it starts over and has both attempts again
    expect(l.acquire('older').allowed).toBe(true)
  })

  it('flooding the map with other keys does not clear a locked-out key', () => {
    const l = new LoginRateLimiter(2, WINDOW, 3)
    hit(l, 'target', 2)
    expect(l.acquire('target').allowed).toBe(false)
    for (let i = 0; i < 1000; i++) l.acquire(`flood${i}`)
    expect(l.size).toBe(3)
    expect(l.acquire('target').allowed).toBe(false)
  })

  it('a key with more attempts outlives a flood of single-attempt keys', () => {
    const l = new LoginRateLimiter(5, WINDOW, 3)
    hit(l, 'target', 3)
    for (let i = 0; i < 1000; i++) l.acquire(`flood${i}`)
    // still at 3 used: two more, then refused
    expect(l.acquire('target').allowed).toBe(true)
    expect(l.acquire('target').allowed).toBe(true)
    expect(l.acquire('target').allowed).toBe(false)
  })

  it('when every entry is locked out a new key is admitted untracked, not refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, WINDOW, 2)
    hit(l, 'a')
    hit(l, 'b')
    expect(l.acquire('a').allowed).toBe(false)
    expect(l.acquire('b').allowed).toBe(false)
    expect(l.acquire('c').allowed).toBe(true)
    expect(l.acquire('c').allowed).toBe(true) // untracked: no budget either
    expect(l.size).toBe(2)
    // the locked keys stay locked
    expect(l.acquire('a').allowed).toBe(false)
    expect(l.acquire('b').allowed).toBe(false)
    // warned once per window, not once per request
    expect(warn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WINDOW - 1)
    hit(l, 'd')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns again when it is still saturated in a later window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, WINDOW, 1)
    hit(l, 'a') // t0, locked until t0 + WINDOW
    hit(l, 'b') // saturated
    expect(warn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WINDOW - 1)
    hit(l, 'c')
    expect(warn).toHaveBeenCalledTimes(1) // same window
    // a second locked key keeps the cap full after 'a' expires
    vi.advanceTimersByTime(1)
    hit(l, 'd') // 'a' expired and is purged, 'd' takes its place
    hit(l, 'e') // saturated again, a full window after the first warning
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('defaults', () => {
  it('uses 5 attempts per 15 minutes and the real clock', () => {
    const l = new LoginRateLimiter()
    for (let i = 0; i < 5; i++) expect(l.acquire('a').allowed).toBe(true)
    expect(l.acquire('a')).toEqual({ allowed: false, retryAfterSeconds: 900 })
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(l.acquire('a').allowed).toBe(true)
  })
})
