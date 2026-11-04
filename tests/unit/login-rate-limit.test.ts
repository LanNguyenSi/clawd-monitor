import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LoginRateLimiter,
  KNOWN_GOOD_MAX_KEYS,
  KNOWN_GOOD_TTL_MS,
  KNOWN_GOOD_REFILL_MS,
  KNOWN_GOOD_GLOBAL_REFILL_MS,
} from '@/lib/login-rate-limit'

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

describe('known-good keys under saturation', () => {
  const BIG_WINDOW = 1_000_000
  const TTL = 100_000
  const KEY_REFILL = 10_000
  const GLOBAL_REFILL = 2000
  // 2 slots, both locked (1 attempt each), overflow: one attempt per 100 ms, set of 4 keys
  const mk = (knownMax = 4, knownTtl = TTL) =>
    new LoginRateLimiter(1, BIG_WINDOW, 2, undefined, 50, 100, 1, knownMax, knownTtl, KEY_REFILL, GLOBAL_REFILL)
  const saturated = (l = mk()) => {
    l.acquire('a')
    l.acquire('b')
    return l
  }
  // the shared overflow bucket is empty right after this
  const drainOverflow = (l: LoginRateLimiter) => {
    l.acquire('drain')
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('exports the operator-set values', () => {
    expect(KNOWN_GOOD_MAX_KEYS).toBe(64)
    expect(KNOWN_GOOD_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000)
    expect(KNOWN_GOOD_REFILL_MS).toBe(10_000)
    expect(KNOWN_GOOD_GLOBAL_REFILL_MS).toBe(2000)
  })

  it('saturated + known key: admitted through the reserved bucket while the shared one is empty', () => {
    const l = saturated()
    l.recordSuccess('k')
    drainOverflow(l)
    expect(l.acquire('other')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(l.acquire('k')).toEqual({ allowed: true })
    expect(l.size).toBe(2) // not tracked either
  })

  it('saturated + known key: does not take the shared overflow token', () => {
    const l = saturated()
    l.recordSuccess('k')
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('other').allowed).toBe(true) // the shared token is still there
  })

  it('saturated + unknown key: shared overflow as before, even with other keys known', () => {
    const l = saturated()
    l.recordSuccess('k')
    drainOverflow(l)
    expect(l.acquire('stranger')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    vi.advanceTimersByTime(100)
    expect(l.acquire('stranger').allowed).toBe(true)
  })

  it('saturated + empty set: shared overflow as before', () => {
    const l = saturated()
    expect(l.knownSize).toBe(0)
    drainOverflow(l)
    expect(l.acquire('k').allowed).toBe(false)
  })

  it('saturated + known /48 parent but unknown /64: reserved bucket', () => {
    const l = saturated()
    l.recordSuccess('K64', 'P48')
    drainOverflow(l)
    expect(l.acquire('OTHER64', 'P48')).toEqual({ allowed: true })
  })

  it('saturated + known /64 but unknown parent: reserved bucket', () => {
    const l = saturated()
    l.recordSuccess('K64')
    drainOverflow(l)
    expect(l.acquire('K64', 'NEW48').allowed).toBe(true)
  })

  it('saturated + neither /64 nor /48 known: shared overflow', () => {
    const l = saturated()
    l.recordSuccess('K64', 'P48')
    drainOverflow(l)
    expect(l.acquire('OTHER64', 'OTHER48').allowed).toBe(false)
  })

  it('tracked /64 whose /48 parent was evicted: known key goes through the reserved bucket', () => {
    // key budget 3, parent budget 50, room for 4 entries
    const mkSub = () => new LoginRateLimiter(3, BIG_WINDOW, 4, undefined, 50, 100, 1, 4, TTL, KEY_REFILL, GLOBAL_REFILL)
    const build = () => {
      const l = mkSub()
      l.acquire('c1') // c1 1
      l.acquire('c1', 'P') // c1 2, P 1
      for (let i = 0; i < 3; i++) l.acquire('a')
      for (let i = 0; i < 3; i++) l.acquire('b')
      for (let i = 0; i < 3; i++) l.acquire('d') // evicts P (fewest attempts), d takes its place
      expect(l.size).toBe(4)
      return l
    }
    // without the set the request is a pure overflow client
    const plain = build()
    expect(plain.acquire('c1', 'P').allowed).toBe(true) // the one overflow token
    expect(plain.acquire('c1', 'P').allowed).toBe(false)
    // with the set it has its own reserved attempt
    const known = build()
    known.recordSuccess('c1', 'P')
    expect(known.acquire('c1', 'P')).toEqual({ allowed: true })
    // the tracked /64 was charged (3/3), so its own lockout now applies, as for any key
    expect(known.acquire('c1', 'P')).toEqual({ allowed: false, retryAfterSeconds: 1000 })
    expect(known.size).toBe(4)

  })

  it('caps a known key at one reserved attempt per interval, with Retry-After', () => {
    const l = saturated()
    l.recordSuccess('k')
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 10 })
    vi.advanceTimersByTime(KEY_REFILL - 1)
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    vi.advanceTimersByTime(1)
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 10 })
  })

  it('rounds the Retry-After of a fractional reserved wait up', () => {
    const l = saturated()
    l.recordSuccess('k')
    l.acquire('k')
    vi.advanceTimersByTime(500) // 9.5 s left of the per-key interval
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 10 })
    vi.advanceTimersByTime(8999) // 501 ms left
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })

  it('a refused attempt does not push the next reserved attempt out', () => {
    const l = saturated()
    l.recordSuccess('k')
    l.acquire('k')
    vi.advanceTimersByTime(5000)
    expect(l.acquire('k').allowed).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(l.acquire('k').allowed).toBe(true)
  })

  it('caps all known keys together at one reserved attempt per global interval', () => {
    const l = saturated()
    l.recordSuccess('k1')
    l.recordSuccess('k2')
    expect(l.acquire('k1').allowed).toBe(true)
    expect(l.acquire('k2')).toEqual({ allowed: false, retryAfterSeconds: 2 })
    vi.advanceTimersByTime(GLOBAL_REFILL - 1)
    expect(l.acquire('k2')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    vi.advanceTimersByTime(1)
    expect(l.acquire('k2').allowed).toBe(true) // the refusals did not charge k2
    expect(l.acquire('k1')).toEqual({ allowed: false, retryAfterSeconds: 8 }) // k1 still waits for its own interval
  })

  it('the longer of the per-key and the global wait is reported', () => {
    const l = saturated()
    l.recordSuccess('k1')
    l.recordSuccess('k2')
    l.acquire('k1')
    vi.advanceTimersByTime(GLOBAL_REFILL)
    // k1: own interval has 8 s left, the global one is free
    expect(l.acquire('k1')).toEqual({ allowed: false, retryAfterSeconds: 8 })
    // k2 never used its own interval, the global one is free
    expect(l.acquire('k2').allowed).toBe(true)
  })

  it('charges the most specific known identity: the known /64, not the parent', () => {
    const l = saturated()
    l.recordSuccess('K64', 'P48')
    expect(l.acquire('K64', 'P48').allowed).toBe(true)
    vi.advanceTimersByTime(GLOBAL_REFILL)
    // the parent's own interval is untouched, so another /64 of the /48 gets its attempt
    expect(l.acquire('OTHER64', 'P48').allowed).toBe(true)
    // and that one charged the parent: the next /64 of the /48 waits for it
    vi.advanceTimersByTime(GLOBAL_REFILL)
    expect(l.acquire('THIRD64', 'P48')).toEqual({ allowed: false, retryAfterSeconds: 8 })
  })

  it('an expired /64 falls back to a still-known parent', () => {
    const l = saturated(mk(4, 1000))
    l.recordSuccess('K64', 'P48')
    vi.advanceTimersByTime(600)
    l.recordSuccess('N64', 'P48') // refreshes only the parent
    vi.advanceTimersByTime(600) // K64 is 1200 ms old, P48 600 ms
    expect(l.acquire('K64', 'P48').allowed).toBe(true)
    expect(l.acquire('K64', 'P48').allowed).toBe(false) // charged to P48: its interval holds
  })

  it('a success refresh does not give the key a fresh reserved attempt', () => {
    const l = saturated()
    l.recordSuccess('k')
    l.acquire('k')
    vi.advanceTimersByTime(3000)
    l.recordSuccess('k')
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 7 })
  })

  it('not saturated + known key: tracked like any other, its own lockout applies', () => {
    const l = new LoginRateLimiter(2, BIG_WINDOW, 100, undefined, 50, 100, 1, 4, TTL, KEY_REFILL, GLOBAL_REFILL)
    l.recordSuccess('k')
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('k')).toEqual({ allowed: false, retryAfterSeconds: 1000 })
    expect(l.acquire('k').allowed).toBe(false) // no reserved attempt either
    expect(l.size).toBe(1)
  })

  it('not saturated + known key: the reserved bucket is not used (no per-key spacing)', () => {
    const l = new LoginRateLimiter(5, BIG_WINDOW, 100, undefined, 50, 100, 1, 4, TTL, KEY_REFILL, GLOBAL_REFILL)
    l.recordSuccess('k')
    for (let i = 0; i < 5; i++) expect(l.acquire('k').allowed).toBe(true)
  })

  it('saturated + known key whose own entry is locked: stays refused with the lock wait', () => {
    const l = saturated()
    l.recordSuccess('a') // 'a' is a locked entry of the table
    expect(l.acquire('a')).toEqual({ allowed: false, retryAfterSeconds: 1000 })
    vi.advanceTimersByTime(10_000)
    expect(l.acquire('a').allowed).toBe(false)
  })

  it('a known parent does not lift a locked /64', () => {
    // parent budget 1: the first request locks both its /64 and its /48
    const l = new LoginRateLimiter(1, BIG_WINDOW, 2, undefined, 1, 100, 1, 4, TTL, KEY_REFILL, GLOBAL_REFILL)
    l.acquire('c1', 'P')
    l.recordSuccess('c2', 'P')
    expect(l.acquire('c2', 'P')).toEqual({ allowed: false, retryAfterSeconds: 1000 })
  })

  it('tracking resumes once the table has room, known or not', () => {
    const l = saturated()
    l.recordSuccess('k')
    vi.advanceTimersByTime(BIG_WINDOW)
    expect(l.acquire('k').allowed).toBe(true)
    expect(l.acquire('k').allowed).toBe(false) // tracked: 1/1 used, no reserved bucket
    expect(l.size).toBe(1)
  })

  it('warns about saturation also for a known key, once per window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const l = saturated()
    l.recordSuccess('k')
    l.acquire('k')
    l.acquire('x')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  describe('what enters the set', () => {
    it('only recordSuccess adds: attempts, refusals and locked-out keys never do', () => {
      const l = saturated()
      for (let i = 0; i < 20; i++) l.acquire(`new${i}`, `P${i}`)
      l.acquire('a')
      l.acquire('b', 'Q')
      expect(l.knownSize).toBe(0)
      vi.advanceTimersByTime(100)
      drainOverflow(l)
      expect(l.acquire('new0', 'P0').allowed).toBe(false)
    })

    it('records the /64 and its /48 parent, an IPv4 key alone', () => {
      const l = mk()
      l.recordSuccess('K64', 'P48')
      expect(l.knownSize).toBe(2)
      l.recordSuccess('1.2.3.4')
      expect(l.knownSize).toBe(3)
      l.recordSuccess('1.2.3.4')
      expect(l.knownSize).toBe(3)
    })

    it('a success does not touch the table', () => {
      const l = saturated()
      l.recordSuccess('k', 'P')
      expect(l.size).toBe(2)
    })
  })

  describe('set size', () => {
    it('holds at most the cap and drops the least recently successful first', () => {
      const l = saturated(mk(3))
      for (const k of ['k1', 'k2', 'k3', 'k4']) {
        l.recordSuccess(k)
        vi.advanceTimersByTime(1)
      }
      expect(l.knownSize).toBe(3)
      vi.advanceTimersByTime(GLOBAL_REFILL)
      drainOverflow(l)
      expect(l.acquire('k1').allowed).toBe(false) // dropped: shared bucket, which is empty
      expect(l.acquire('k2').allowed).toBe(true)
      vi.advanceTimersByTime(GLOBAL_REFILL)
      expect(l.acquire('k3').allowed).toBe(true)
      vi.advanceTimersByTime(GLOBAL_REFILL)
      expect(l.acquire('k4').allowed).toBe(true)
    })

    it('a repeated success makes the key the most recent one', () => {
      const l = saturated(mk(3))
      l.recordSuccess('k1')
      l.recordSuccess('k2')
      l.recordSuccess('k3')
      l.recordSuccess('k1') // now k2 is the least recent
      l.recordSuccess('k4')
      expect(l.knownSize).toBe(3)
      vi.advanceTimersByTime(GLOBAL_REFILL)
      drainOverflow(l)
      expect(l.acquire('k2').allowed).toBe(false)
      expect(l.acquire('k1').allowed).toBe(true)
    })

    it('an IPv6 success counts two keys; the oldest one goes first, the /64 outlives its parent', () => {
      const l = saturated(mk(3))
      l.recordSuccess('K1', 'P1')
      l.recordSuccess('K2', 'P2') // 4 keys: P1 goes
      expect(l.knownSize).toBe(3)
      drainOverflow(l)
      expect(l.acquire('other', 'P1').allowed).toBe(false)
      expect(l.acquire('K1').allowed).toBe(true)
    })

    it('with the default cap it keeps 64 keys and forgets the 65th oldest', () => {
      const l = new LoginRateLimiter(1, BIG_WINDOW, 2, undefined, 50, 100, 1)
      l.acquire('a')
      l.acquire('b')
      for (let i = 0; i < 65; i++) l.recordSuccess(`k${i}`)
      expect(l.knownSize).toBe(64)
      l.acquire('drain')
      expect(l.acquire('k0').allowed).toBe(false)
      expect(l.acquire('k1').allowed).toBe(true)
    })
  })

  describe('expiry', () => {
    it('a key is known until the TTL after its last success, not longer', () => {
      const l = saturated()
      l.recordSuccess('k')
      vi.advanceTimersByTime(TTL - 1)
      expect(l.acquire('k').allowed).toBe(true)
      vi.advanceTimersByTime(1)
      drainOverflow(l)
      expect(l.acquire('k').allowed).toBe(false) // expired: shared bucket
      expect(l.knownSize).toBe(0)
    })

    it('a new success restarts the TTL', () => {
      const l = saturated()
      l.recordSuccess('k')
      vi.advanceTimersByTime(TTL - 1)
      l.recordSuccess('k')
      vi.advanceTimersByTime(TTL - 1)
      drainOverflow(l) // otherwise the shared token would let an expired key in
      expect(l.acquire('k').allowed).toBe(true)
      // the TTL runs from the second success: one more ms and the key is forgotten
      vi.advanceTimersByTime(1)
      drainOverflow(l)
      expect(l.acquire('k').allowed).toBe(false)
    })

    it('the default parameters keep a key known for 14 days after its last success, not longer', () => {
      const DAY = 24 * 60 * 60 * 1000
      // default known-good parameters; a long window so the locked entries outlast the test
      const l = new LoginRateLimiter(1, 30 * DAY, 2, undefined, 50, 100, 1)
      l.acquire('a')
      l.acquire('b')
      l.recordSuccess('k')
      vi.advanceTimersByTime(14 * DAY - 1)
      drainOverflow(l)
      expect(l.acquire('k').allowed).toBe(true)
      vi.advanceTimersByTime(1)
      drainOverflow(l)
      expect(l.acquire('k').allowed).toBe(false)
    })

    it('a refused or reserved attempt does not extend the TTL', () => {
      const l = saturated()
      l.recordSuccess('k')
      vi.advanceTimersByTime(TTL / 2)
      expect(l.acquire('k').allowed).toBe(true)
      vi.advanceTimersByTime(TTL / 2)
      drainOverflow(l)
      expect(l.acquire('k').allowed).toBe(false)
    })
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
