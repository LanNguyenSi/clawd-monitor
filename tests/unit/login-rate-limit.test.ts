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
    // the newcomer is tracked, not let in free: 4 more attempts, then refused
    for (let i = 0; i < 4; i++) expect(l.acquire('new').allowed).toBe(true)
    expect(l.acquire('new').allowed).toBe(false)
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

  it('a flood of single-attempt keys keeps every newcomer tracked', () => {
    const l = new LoginRateLimiter(5, WINDOW, 3)
    for (let i = 0; i < 100; i++) {
      const key = `flood${i}`
      hit(l, key)
      // tracked: 4 more attempts, then refused, however many keys came before
      expect(l.acquire(key).allowed).toBe(true)
    }
  })
})

describe('saturation: every entry locked out', () => {
  const hit = (l: LoginRateLimiter, key: string, n = 1) => {
    for (let i = 0; i < n; i++) l.acquire(key)
  }
  // 2 slots, both locked (1 attempt each), overflow: one attempt per 100 ms
  const saturated = () => {
    const l = new LoginRateLimiter(1, WINDOW, 2, undefined, 50, 100, 1)
    hit(l, 'a')
    hit(l, 'b')
    return l
  }

  it('never lets newcomers in for free: untracked attempts are capped by the overflow bucket', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    let allowed = 0
    // 99 requests from 99 different clients, one every 10 ms, inside one window
    for (let i = 0; i < 99; i++) {
      if (l.acquire(`new${i}`).allowed) allowed++
      vi.advanceTimersByTime(10)
    }
    // t = 0, 100, ..., 900 each find a token (burst 1, refill 100 ms)
    expect(allowed).toBe(10)
  })

  it('the same newcomer gets no tracked budget either, only the bucket rate', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    expect(l.acquire('c').allowed).toBe(true)
    expect(l.acquire('c').allowed).toBe(false) // no token left, and not tracked as 1/1 either
    vi.advanceTimersByTime(100)
    expect(l.acquire('c').allowed).toBe(true) // a token again; an untracked key has no lockout
    expect(l.size).toBe(2)
  })

  it('refuses with a short Retry-After while the bucket is empty', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    l.acquire('c')
    expect(l.acquire('d')).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })

  it('rounds a long refill interval up to whole seconds', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, 60_000, 1, undefined, 50, 2500, 1)
    hit(l, 'a')
    l.acquire('c')
    expect(l.acquire('d')).toEqual({ allowed: false, retryAfterSeconds: 3 })
    vi.advanceTimersByTime(1000)
    expect(l.acquire('d')).toEqual({ allowed: false, retryAfterSeconds: 2 })
  })

  it('holds at most `burst` tokens however long it was idle', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, 100_000, 1, undefined, 50, 100, 2)
    hit(l, 'a')
    vi.advanceTimersByTime(50_000)
    expect(l.acquire('x').allowed).toBe(true)
    expect(l.acquire('y').allowed).toBe(true)
    expect(l.acquire('z').allowed).toBe(false)
  })

  it('the locked keys stay locked and keep their lockout', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    for (let i = 0; i < 20; i++) l.acquire(`new${i}`)
    expect(l.acquire('a').allowed).toBe(false)
    expect(l.acquire('b').allowed).toBe(false)
    expect(l.size).toBe(2)
  })

  it('newcomers are tracked again once the locked entries have expired', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    vi.advanceTimersByTime(WINDOW)
    expect(l.acquire('c').allowed).toBe(true)
    expect(l.acquire('c').allowed).toBe(false) // tracked: 1/1 used
  })

  it('warns once per window, not once per request', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    for (let i = 0; i < 5; i++) l.acquire(`new${i}`)
    expect(warn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WINDOW - 1)
    l.acquire('late')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns again in a later window while still saturated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, WINDOW, 1, undefined, 50, 100, 1)
    hit(l, 'a') // locked until WINDOW
    l.acquire('b')
    expect(warn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WINDOW)
    hit(l, 'd') // 'a' expired, 'd' takes the slot and is locked until 2 * WINDOW
    l.acquire('e') // saturated again, a full window after the first warning
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('parent key (the /48 around an IPv6 client)', () => {
  // child budget 2, parent budget 3
  const mk = () => new LoginRateLimiter(2, WINDOW, 100, undefined, 3, 100, 1)

  it('charges both keys', () => {
    const l = mk()
    l.acquire('c1', 'P')
    l.acquire('c1', 'P')
    expect(l.acquire('c1', 'P').allowed).toBe(false) // child budget 2
    expect(l.size).toBe(2)
  })

  it('refuses a fresh child once the parent budget is used up, whatever the child', () => {
    const l = mk()
    expect(l.acquire('c1', 'P').allowed).toBe(true)
    expect(l.acquire('c2', 'P').allowed).toBe(true)
    expect(l.acquire('c3', 'P').allowed).toBe(true)
    expect(l.acquire('c4', 'P').allowed).toBe(false)
    expect(l.acquire('c5', 'P').allowed).toBe(false)
  })

  it('a refused request is not charged to either key', () => {
    const l = mk()
    l.acquire('c1', 'P')
    l.acquire('c1', 'P')
    expect(l.acquire('c1', 'P').allowed).toBe(false) // child used up, parent must stay at 2
    expect(l.acquire('c2', 'P').allowed).toBe(true) // parent 3/3
    expect(l.acquire('c3', 'P').allowed).toBe(false)
    // the parent refusal did not create an entry for c3 or charge c2
    expect(l.size).toBe(3)
    expect(l.acquire('c2').allowed).toBe(true) // c2 had 1 of 2
    expect(l.acquire('c2').allowed).toBe(false)
  })

  it('other parents are unaffected', () => {
    const l = mk()
    for (let i = 0; i < 3; i++) l.acquire(`c${i}`, 'P')
    expect(l.acquire('x', 'Q').allowed).toBe(true)
  })

  it('without a parent only the child budget applies', () => {
    const l = mk()
    expect(l.acquire('c1').allowed).toBe(true)
    expect(l.acquire('c1').allowed).toBe(true)
    expect(l.acquire('c1').allowed).toBe(false)
  })

  it('waits for the later of the two windows', () => {
    const l = new LoginRateLimiter(1, 10_000, 100, undefined, 2, 100, 1)
    l.acquire('a', 'P') // t0: a 1/1, P 1/2, window to 10 s
    vi.advanceTimersByTime(4000)
    l.acquire('b', 'P') // b 1/1 (window to 14 s), P 2/2 (window to 10 s)
    vi.advanceTimersByTime(1000) // t = 5 s
    expect(l.acquire('b', 'P')).toEqual({ allowed: false, retryAfterSeconds: 9 })
  })

  it('reset clears the child and the parent', () => {
    const l = mk()
    for (let i = 0; i < 3; i++) l.acquire(`c${i}`, 'P')
    l.reset('c0', 'P')
    expect(l.size).toBe(2) // c1, c2 remain
    expect(l.acquire('c9', 'P').allowed).toBe(true)
  })

  it('reset of a child alone leaves other keys', () => {
    const l = mk()
    l.acquire('c1', 'P')
    l.reset('c1')
    expect(l.size).toBe(1)
  })

  it('a parent that is locked is never evicted, one in use by this request is not either', () => {
    // 3 slots: P (1 attempt, oldest), a, x
    const l = new LoginRateLimiter(5, WINDOW, 3, undefined, 50, 100, 1)
    l.acquire('P')
    vi.advanceTimersByTime(10)
    l.acquire('a')
    vi.advanceTimersByTime(10)
    l.acquire('x')
    vi.advanceTimersByTime(10)
    l.acquire('b', 'P') // needs a slot for b: evicts a (P is protected although it is the oldest)
    expect(l.size).toBe(3)
    // P now has 2 of its 5 here: 3 more attempts, then refused
    for (let i = 0; i < 3; i++) expect(l.acquire('P').allowed).toBe(true)
    expect(l.acquire('P').allowed).toBe(false)
  })

  it('a parent entry is locked at the parent budget, not the child budget', () => {
    // maxKeys 2, child budget 1, parent budget 50: a parent entry with 1 attempt is NOT locked out
    const l = new LoginRateLimiter(1, WINDOW, 2, undefined, 50, 100, 1)
    l.acquire('c1', 'P') // c1 locked (1/1), P at 1 of 50
    // a newcomer needs room: c1 is locked, P is evictable -> P goes, the newcomer is tracked
    expect(l.acquire('n').allowed).toBe(true)
    // tracked, so its one attempt stays used up even after the overflow bucket refilled
    vi.advanceTimersByTime(100)
    expect(l.acquire('n').allowed).toBe(false)
    expect(l.size).toBe(2)
  })

  it('when the parent cannot be tracked either the request goes through the overflow bucket', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = new LoginRateLimiter(1, WINDOW, 2, undefined, 50, 100, 1)
    l.acquire('a')
    l.acquire('b')
    expect(l.acquire('c', 'P').allowed).toBe(true) // the one token
    expect(l.acquire('d', 'Q').allowed).toBe(false)
    expect(l.size).toBe(2)
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
