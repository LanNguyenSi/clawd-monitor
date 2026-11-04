/** Failed (or in-flight) attempts one client may make per window. */
export const LOGIN_MAX_ATTEMPTS = 5
/** Same for the /48 around an IPv6 client: many /64s, so a larger budget. */
export const LOGIN_MAX_ATTEMPTS_PER_PARENT = 50
/** Window length; a client that used up its attempts waits for it to end. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
/** Most client keys tracked at once. */
export const LOGIN_MAX_TRACKED_KEYS = 10_000
/** While the table is saturated, untracked clients share this refill interval, one attempt each. */
export const OVERFLOW_REFILL_MS = 1000
/** Attempts the shared overflow bucket holds when it is full. */
export const OVERFLOW_BURST = 1

interface Entry {
  attempts: number
  windowStart: number
  /** The budget this entry was created with (a /48 parent has a larger one). */
  max: number
}

export type LoginGate = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * In-memory attempt limiter, one process only (the app runs as one container).
 *
 * A key gets `max` attempts per fixed window that starts at its first attempt;
 * once they are used up every further attempt is refused until the window
 * ends, whether or not the password would be right. An attempt is counted when
 * it is admitted (before the password is checked), so parallel requests cannot
 * all pass a check made before any of them has failed; a successful login
 * removes the key, which is what turns the count into a count of failures.
 *
 * A request may carry a second, coarser `parent` key (the /48 of an IPv6
 * client) with its own, larger budget. Both must have budget left; if either is
 * used up the request is refused and neither is charged.
 *
 * Memory is bounded by `maxKeys`. When new keys arrive at the cap, expired
 * entries go first, then the entries with the fewest attempts (oldest first)
 * that are not already locked out. Locked-out entries are never evicted, so
 * flooding the map with other keys cannot clear a key that is locked. If no
 * room can be made (every entry is locked out), the request is not tracked but
 * is never let in for free either: all such requests share one overflow bucket
 * that refills one attempt per `overflowRefillMs` and holds at most
 * `overflowBurst`; without a token the answer is a refusal with a short
 * Retry-After. That keeps guessing capped at about one attempt per refill
 * interval for everyone not yet tracked, and the real admin gets in after a
 * brief retry, at the price that a flooder can keep the overflow bucket empty
 * and so make that retry succeed only now and then.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>()
  private lastSaturationWarn = -Infinity
  // Overflow bucket credit in milliseconds (one attempt costs overflowRefillMs), so the
  // arithmetic stays exact.
  private overflowCredit: number
  private overflowStamp = 0

  constructor(
    private readonly max: number = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs: number = LOGIN_WINDOW_MS,
    private readonly maxKeys: number = LOGIN_MAX_TRACKED_KEYS,
    private readonly now: () => number = () => Date.now(),
    private readonly parentMax: number = LOGIN_MAX_ATTEMPTS_PER_PARENT,
    private readonly overflowRefillMs: number = OVERFLOW_REFILL_MS,
    private readonly overflowBurst: number = OVERFLOW_BURST,
  ) {
    this.overflowCredit = overflowBurst * overflowRefillMs
  }

  get size(): number {
    return this.entries.size
  }

  /** Count an attempt for `key` (and `parent`), or refuse it with the seconds to wait. */
  acquire(key: string, parent?: string): LoginGate {
    const t = this.now()
    const slots = [{ key, max: this.max }]
    if (parent !== undefined) slots.push({ key: parent, max: this.parentMax })
    const live = slots.map((s) => ({ ...s, entry: this.liveEntry(s.key, t) }))

    let wait = 0
    for (const s of live) {
      if (s.entry && s.entry.attempts >= s.max) {
        const remainingMs = s.entry.windowStart + this.windowMs - t
        wait = Math.max(wait, Math.max(1, Math.ceil(remainingMs / 1000)))
      }
    }
    if (wait > 0) return { allowed: false, retryAfterSeconds: wait }

    const missing = live.filter((s) => !s.entry).length
    const tracked = missing === 0 || this.makeRoom(missing, new Set(slots.map((s) => s.key)), t)
    if (!tracked) {
      if (t - this.lastSaturationWarn >= this.windowMs) {
        this.lastSaturationWarn = t
        console.warn('[auth] Attempt limiter is full of locked-out clients; new clients share a rate-limited overflow bucket')
      }
      const overflow = this.takeOverflowToken(t)
      if (!overflow.allowed) return overflow
    }
    for (const s of live) {
      if (s.entry) s.entry.attempts += 1
      else if (tracked) this.entries.set(s.key, { attempts: 1, windowStart: t, max: s.max })
    }
    return { allowed: true }
  }

  /** Forget `key` and `parent` (a successful login). */
  reset(key: string, parent?: string): void {
    this.entries.delete(key)
    if (parent !== undefined) this.entries.delete(parent)
  }

  // The entry of `key` unless its window is over (then it is dropped).
  private liveEntry(key: string, t: number): Entry | undefined {
    const entry = this.entries.get(key)
    if (entry && t - entry.windowStart >= this.windowMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  // Make room for `n` new entries; false if that is not possible.
  private makeRoom(n: number, protect: Set<string>, t: number): boolean {
    if (this.entries.size + n <= this.maxKeys) return true
    this.purgeExpired(t)
    while (this.entries.size + n > this.maxKeys) {
      if (!this.evictOne(protect)) return false
    }
    return true
  }

  private takeOverflowToken(t: number): LoginGate {
    this.overflowCredit = Math.min(this.overflowBurst * this.overflowRefillMs, this.overflowCredit + (t - this.overflowStamp))
    this.overflowStamp = t
    if (this.overflowCredit >= this.overflowRefillMs) {
      this.overflowCredit -= this.overflowRefillMs
      return { allowed: true }
    }
    const waitMs = this.overflowRefillMs - this.overflowCredit
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
  }

  private purgeExpired(t: number): void {
    for (const [k, e] of this.entries) {
      if (t - e.windowStart >= this.windowMs) this.entries.delete(k)
    }
  }

  // Drop the least threatening entry that is not locked out or in `protect`; false if none.
  private evictOne(protect: Set<string>): boolean {
    let victim: string | undefined
    let best: Entry | undefined
    for (const [k, e] of this.entries) {
      if (e.attempts >= e.max || protect.has(k)) continue
      if (!best || e.attempts < best.attempts || (e.attempts === best.attempts && e.windowStart < best.windowStart)) {
        victim = k
        best = e
      }
    }
    if (victim === undefined) return false
    this.entries.delete(victim)
    return true
  }
}

/** Attempts at POST /api/auth. */
export const loginRateLimiter = new LoginRateLimiter()
/** Attempts at the current-password check of POST /api/auth/change-password; its own key space. */
export const passwordChangeRateLimiter = new LoginRateLimiter()
