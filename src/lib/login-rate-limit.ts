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
/** Most client keys remembered as known good (a /64 and its /48 each count as one key). */
export const KNOWN_GOOD_MAX_KEYS = 64
/** How long a key stays known good after its last successful login. */
export const KNOWN_GOOD_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** While the table is saturated, a known-good key gets one attempt per this interval (burst 1). */
export const KNOWN_GOOD_REFILL_MS = 10_000
/** While the table is saturated, all known-good keys together get one attempt per this interval. */
export const KNOWN_GOOD_GLOBAL_REFILL_MS = 2000

interface Entry {
  attempts: number
  windowStart: number
  /** The budget this entry was created with (a /48 parent has a larger one). */
  max: number
}

interface KnownGood {
  /** When this key last logged in successfully. */
  lastSuccess: number
  /** When this key last used its reserved attempt while the table was saturated. */
  lastReserved: number
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
 * interval for everyone not yet tracked. A flooder can keep that bucket empty,
 * so a client that is not known good (see below) gets in only now and then.
 *
 * To keep the real admin from depending on that, a separate small set of known
 * good keys is kept (`recordSuccess`, called only after a verified successful
 * login; at most `knownMaxKeys`, least recently successful dropped first, each
 * forgotten `knownTtlMs` after its last success). It is not part of `entries`,
 * so a flood of failed attempts can neither fill nor evict it. A request that
 * cannot be tracked and whose key (or IPv6 /48 parent) is known good does not
 * use the shared overflow bucket but a reserved one: one attempt per
 * `knownRefillMs` per known key, and one per `knownGlobalRefillMs` across all
 * known keys, so guessing through it stays capped. Everywhere else a known key
 * is treated like any other: it is tracked while there is room and its own
 * lockout always applies. A first login from a new key during a flood is not
 * helped, and the set is lost on restart, like the table.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>()
  private lastSaturationWarn = -Infinity
  // Overflow bucket credit in milliseconds (one attempt costs overflowRefillMs), so the
  // arithmetic stays exact.
  private overflowCredit: number
  private overflowStamp = 0
  // Least recently successful first (a refresh moves a key to the end).
  private readonly known = new Map<string, KnownGood>()
  private lastReservedAny = -Infinity

  constructor(
    private readonly max: number = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs: number = LOGIN_WINDOW_MS,
    private readonly maxKeys: number = LOGIN_MAX_TRACKED_KEYS,
    private readonly now: () => number = () => Date.now(),
    private readonly parentMax: number = LOGIN_MAX_ATTEMPTS_PER_PARENT,
    private readonly overflowRefillMs: number = OVERFLOW_REFILL_MS,
    private readonly overflowBurst: number = OVERFLOW_BURST,
    private readonly knownMaxKeys: number = KNOWN_GOOD_MAX_KEYS,
    private readonly knownTtlMs: number = KNOWN_GOOD_TTL_MS,
    private readonly knownRefillMs: number = KNOWN_GOOD_REFILL_MS,
    private readonly knownGlobalRefillMs: number = KNOWN_GOOD_GLOBAL_REFILL_MS,
  ) {
    this.overflowCredit = overflowBurst * overflowRefillMs
  }

  get size(): number {
    return this.entries.size
  }

  /** Number of keys currently remembered as known good (expired ones may still be counted). */
  get knownSize(): number {
    return this.known.size
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
      const untracked = this.takeUntrackedToken(key, parent, t)
      if (!untracked.allowed) return untracked
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

  /**
   * Remember `key` and `parent` as known good. Call it only after a verified
   * successful login: a failed attempt must never add to the set.
   */
  recordSuccess(key: string, parent?: string): void {
    const t = this.now()
    // The parent first, so the key (the more specific one) is the last to be dropped.
    if (parent !== undefined) this.touchKnown(parent, t)
    this.touchKnown(key, t)
    // Least recently successful first: the Map keeps insertion order and a refresh re-inserts.
    for (const oldest of this.known.keys()) {
      if (this.known.size <= this.knownMaxKeys) break
      this.known.delete(oldest)
    }
  }

  // Add or refresh a known-good key as the most recent one; keeps its reserved-bucket state.
  private touchKnown(k: string, t: number): void {
    const lastReserved = this.known.get(k)?.lastReserved ?? -Infinity
    this.known.delete(k)
    this.known.set(k, { lastSuccess: t, lastReserved })
  }

  // The known-good key that covers this request (the key itself first, then its parent), if any.
  private knownKeyFor(key: string, parent: string | undefined, t: number): string | undefined {
    for (const k of parent === undefined ? [key] : [key, parent]) {
      const entry = this.known.get(k)
      if (!entry) continue
      if (t - entry.lastSuccess >= this.knownTtlMs) {
        this.known.delete(k)
        continue
      }
      return k
    }
    return undefined
  }

  // Gate for a request that cannot be tracked: a known-good key uses the reserved
  // bucket, everyone else the shared overflow bucket.
  private takeUntrackedToken(key: string, parent: string | undefined, t: number): LoginGate {
    const knownKey = this.knownKeyFor(key, parent, t)
    return knownKey === undefined ? this.takeOverflowToken(t) : this.takeReservedToken(knownKey, t)
  }

  // One attempt per `knownRefillMs` for this known key and one per `knownGlobalRefillMs`
  // across all of them; a refusal charges neither.
  private takeReservedToken(knownKey: string, t: number): LoginGate {
    const entry = this.known.get(knownKey) as KnownGood
    const keyWaitMs = entry.lastReserved + this.knownRefillMs - t
    const globalWaitMs = this.lastReservedAny + this.knownGlobalRefillMs - t
    const waitMs = Math.max(keyWaitMs, globalWaitMs)
    if (waitMs > 0) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
    entry.lastReserved = t
    this.lastReservedAny = t
    return { allowed: true }
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
