/** Failed (or in-flight) logins one client may make per window. */
export const LOGIN_MAX_ATTEMPTS = 5
/** Window length; a client that used up its attempts waits for it to end. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
/** Most client keys tracked at once. */
export const LOGIN_MAX_TRACKED_KEYS = 10_000

interface Entry {
  attempts: number
  windowStart: number
}

export type LoginGate = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * In-memory login limiter, one process only (the app runs as one container).
 *
 * A key gets `max` attempts per fixed window that starts at its first attempt;
 * once they are used up every further attempt is refused until the window
 * ends, whether or not the password would be right. An attempt is counted when
 * it is admitted (before the password is checked), so parallel requests cannot
 * all pass a check made before any of them has failed; a successful login
 * removes the key, which is what turns the count into a count of failures.
 *
 * Memory is bounded by `maxKeys`. When a new key arrives at the cap, expired
 * entries go first, then the entry with the fewest attempts (oldest first)
 * that is not already locked out. Locked-out entries are never evicted, so
 * flooding the map with other keys cannot clear a key that is locked. If every
 * entry is locked out, the new key is admitted untracked rather than refused:
 * filling the cap takes `maxKeys` distinct clients that each failed `max`
 * times in one window, and refusing everyone else would turn that into a
 * lock-out of the real admin.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>()
  private lastSaturationWarn = -Infinity

  constructor(
    private readonly max: number = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs: number = LOGIN_WINDOW_MS,
    private readonly maxKeys: number = LOGIN_MAX_TRACKED_KEYS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.entries.size
  }

  /** Count an attempt for `key`, or refuse it with the seconds until the window ends. */
  acquire(key: string): LoginGate {
    const t = this.now()
    let entry = this.entries.get(key)
    if (entry && t - entry.windowStart >= this.windowMs) {
      this.entries.delete(key)
      entry = undefined
    }
    if (entry) {
      if (entry.attempts >= this.max) {
        const remainingMs = entry.windowStart + this.windowMs - t
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) }
      }
      entry.attempts += 1
      return { allowed: true }
    }
    if (this.entries.size >= this.maxKeys) {
      this.purgeExpired(t)
      if (this.entries.size >= this.maxKeys && !this.evictOne()) {
        if (t - this.lastSaturationWarn >= this.windowMs) {
          this.lastSaturationWarn = t
          console.warn('[auth] Login limiter is full of locked-out clients; new clients are admitted untracked')
        }
        return { allowed: true }
      }
    }
    this.entries.set(key, { attempts: 1, windowStart: t })
    return { allowed: true }
  }

  /** Forget `key` (a successful login). */
  reset(key: string): void {
    this.entries.delete(key)
  }

  private purgeExpired(t: number): void {
    for (const [k, e] of this.entries) {
      if (t - e.windowStart >= this.windowMs) this.entries.delete(k)
    }
  }

  // Drop the least threatening entry that is not locked out; false if none.
  private evictOne(): boolean {
    let victim: string | undefined
    let best: Entry | undefined
    for (const [k, e] of this.entries) {
      if (e.attempts >= this.max) continue
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

export const loginRateLimiter = new LoginRateLimiter()
