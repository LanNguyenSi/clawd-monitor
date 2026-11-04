import { createHash, timingSafeEqual } from 'crypto'

/**
 * Constant-time string equality. Both sides are reduced to SHA-256 digests
 * first, so timingSafeEqual always sees two buffers of the same length: a
 * length difference neither throws nor shortens the comparison.
 */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest()
  const db = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(da, db)
}
