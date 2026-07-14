// @vitest-environment jsdom
/**
 * Unit tests for src/lib/fetcher.ts (shared SWR fetcher)
 *
 * `redirecting` is module-level mutable state, so each test reloads the
 * module fresh via vi.resetModules() + dynamic import. Reusing one imported
 * module across tests would let a 401 test leak `redirecting = true` into
 * a later test and silently suppress its window.location.href assertion.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'

/** Load a fresh instance of the fetcher module (fresh `redirecting` state). */
async function loadFetcher() {
  vi.resetModules()
  return import('@/lib/fetcher')
}

function mockLocation() {
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { href: '' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

// ── 200 -> parsed JSON ─────────────────────────────────────────────────────────

describe('fetcher – 200 response', () => {
  it('resolves with the parsed JSON body', async () => {
    const data = { hello: 'world' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => data,
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/thing')).resolves.toEqual(data)
  })
})

// ── 401 -> throws + redirects ──────────────────────────────────────────────────

describe('fetcher – 401 response', () => {
  it('throws Error("Session expired") and sets window.location.href to /login', async () => {
    mockLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({}),
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/thing')).rejects.toThrow('Session expired')
    expect(window.location.href).toBe('/login')
  })

  it('a second 401 in a freshly reloaded module still redirects (proves no cross-test leak)', async () => {
    mockLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({}),
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/other')).rejects.toThrow('Session expired')
    expect(window.location.href).toBe('/login')
  })

  it('does not redirect again for a second 401 within the SAME module instance', async () => {
    mockLocation()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({}),
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/thing')).rejects.toThrow('Session expired')
    expect(window.location.href).toBe('/login')

    // Reset href to observe whether the second call re-assigns it.
    window.location.href = ''
    await expect(fetcher('/api/thing')).rejects.toThrow('Session expired')
    expect(window.location.href).toBe('')
  })
})

// ── non-ok, non-401 -> throws with status ──────────────────────────────────────

describe('fetcher – non-ok, non-401 response', () => {
  it('throws an Error carrying the response status and server-provided message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        json: async () => ({ error: 'Boom' }),
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/thing')).rejects.toMatchObject({
      message: 'Boom',
      status: 500,
    })
  })

  it('falls back to "Request failed" when the body has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 503,
        ok: false,
        json: async () => ({}),
      }),
    )
    const { fetcher } = await loadFetcher()

    await expect(fetcher('/api/thing')).rejects.toMatchObject({
      message: 'Request failed',
      status: 503,
    })
  })
})
