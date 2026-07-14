// @vitest-environment jsdom
/**
 * Unit tests for src/lib/instance.ts (localStorage instance manager)
 *
 * Runs under jsdom (see docblock above) because the module reads/writes
 * `window.localStorage`. localStorage is cleared between tests so state
 * does not leak across cases.
 *
 * DEFAULT_INSTANCE.gatewayUrl is a module-level const derived from
 * process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL at import time, so the module
 * is loaded dynamically in beforeAll AFTER explicitly unsetting that env var
 * (vi.stubEnv(..., undefined)). This keeps the test hermetic: an ambient
 * NEXT_PUBLIC_DEFAULT_GATEWAY_URL in the runner's environment cannot change
 * the fallback value this file asserts against.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { Instance } from '@/types'

const DEFAULT_INSTANCE: Instance = {
  id: 'default',
  name: 'Local OpenClaw',
  gatewayUrl: 'http://localhost:9500',
  token: '',
}

// Mirrors the module-private STORAGE_KEY constant in src/lib/instance.ts.
const STORAGE_KEY = 'clawd-monitor:instances'

let instanceLib: typeof import('@/lib/instance')

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_DEFAULT_GATEWAY_URL', undefined)
  vi.resetModules()
  instanceLib = await import('@/lib/instance')
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/**
 * Seed localStorage directly with a raw instances array, bypassing
 * saveInstance(). This matters because saveInstance() itself reads via
 * getInstances() first, which falls back to [DEFAULT_INSTANCE] on empty
 * storage -- so calling saveInstance() from empty storage would silently
 * prepend DEFAULT_INSTANCE to the result. Seeding directly gives tests a
 * known, artifact-free baseline to assert against.
 */
function seedInstances(instances: Instance[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(instances))
}

beforeEach(() => {
  window.localStorage.clear()
})

// ── saveInstance / getInstances round-trip ────────────────────────────────────

describe('saveInstance / getInstances', () => {
  it('round-trips a saved instance through getInstances', () => {
    const existing: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    seedInstances([existing])

    const inst: Instance = { id: 'b', name: 'Agent B', gatewayUrl: 'http://b:1', token: 'tok-b' }
    instanceLib.saveInstance(inst)

    expect(instanceLib.getInstances()).toEqual([existing, inst])
  })

  it('saveInstance replaces an existing instance with the same id instead of duplicating it', () => {
    const inst: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    seedInstances([inst])

    const updated: Instance = { ...inst, name: 'Agent A renamed' }
    instanceLib.saveInstance(updated)

    expect(instanceLib.getInstances()).toEqual([updated])
  })

  it('saveInstance appends to existing instances', () => {
    const a: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    const b: Instance = { id: 'b', name: 'Agent B', gatewayUrl: 'http://b:1', token: 'tok-b' }
    seedInstances([a])
    instanceLib.saveInstance(b)
    expect(instanceLib.getInstances()).toEqual([a, b])
  })

  it('getInstances returns [DEFAULT_INSTANCE] when storage is empty', () => {
    expect(instanceLib.getInstances()).toEqual([DEFAULT_INSTANCE])
  })

  it('getInstances returns [DEFAULT_INSTANCE] when the stored value is corrupt JSON', () => {
    window.localStorage.setItem('clawd-monitor:instances', '{not json')
    expect(instanceLib.getInstances()).toEqual([DEFAULT_INSTANCE])
  })

  it('getInstances returns [DEFAULT_INSTANCE] when the stored array is empty', () => {
    window.localStorage.setItem('clawd-monitor:instances', JSON.stringify([]))
    expect(instanceLib.getInstances()).toEqual([DEFAULT_INSTANCE])
  })
})

// ── removeInstance cascade ─────────────────────────────────────────────────────

describe('removeInstance – cascade behavior on the active instance', () => {
  it('removing a non-active instance leaves the active instance untouched', () => {
    const a: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    const b: Instance = { id: 'b', name: 'Agent B', gatewayUrl: 'http://b:1', token: 'tok-b' }
    seedInstances([a, b])
    instanceLib.setActiveInstance('b')

    instanceLib.removeInstance('a')

    expect(instanceLib.getInstances()).toEqual([b])
    expect(instanceLib.getActiveInstanceId()).toBe('b')
  })

  it('removing the active instance falls back to the next remaining instance', () => {
    const a: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    const b: Instance = { id: 'b', name: 'Agent B', gatewayUrl: 'http://b:1', token: 'tok-b' }
    seedInstances([a, b])
    instanceLib.setActiveInstance('a')

    instanceLib.removeInstance('a')

    expect(instanceLib.getInstances()).toEqual([b])
    expect(instanceLib.getActiveInstanceId()).toBe('b')
  })

  it('removing the active instance when no others remain clears ACTIVE_KEY', () => {
    const a: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    seedInstances([a])
    instanceLib.setActiveInstance('a')

    instanceLib.removeInstance('a')

    expect(instanceLib.getInstances()).toEqual([DEFAULT_INSTANCE])
    expect(instanceLib.getActiveInstanceId()).toBeNull()
  })
})

// ── getActiveInstanceId / getActiveInstance / setActiveInstance ───────────────

describe('getActiveInstanceId / getActiveInstance / setActiveInstance', () => {
  it('getActiveInstanceId returns null when nothing is active', () => {
    expect(instanceLib.getActiveInstanceId()).toBeNull()
  })

  it('setActiveInstance persists the id read back by getActiveInstanceId', () => {
    instanceLib.setActiveInstance('a')
    expect(instanceLib.getActiveInstanceId()).toBe('a')
  })

  it('getActiveInstance returns DEFAULT_INSTANCE when no active id is set', () => {
    expect(instanceLib.getActiveInstance()).toEqual(DEFAULT_INSTANCE)
  })

  it('getActiveInstance returns DEFAULT_INSTANCE when the active id does not match any stored instance', () => {
    instanceLib.setActiveInstance('missing')
    expect(instanceLib.getActiveInstance()).toEqual(DEFAULT_INSTANCE)
  })

  it('getActiveInstance returns the matching stored instance', () => {
    const a: Instance = { id: 'a', name: 'Agent A', gatewayUrl: 'http://a:1', token: 'tok-a' }
    seedInstances([a])
    instanceLib.setActiveInstance('a')
    expect(instanceLib.getActiveInstance()).toEqual(a)
  })
})

// ── getInstances – typeof window === 'undefined' (SSR) guard ──────────────────
// `typeof window === 'undefined'` is true whenever the `window` binding's
// *value* is undefined, not only when it's undeclared, so stubbing the
// global to undefined faithfully reproduces the SSR code path even though
// this file runs under jsdom.
//
// Stubbing `window` alone only proves the guard's RETURN VALUE matches; it
// does not prove the guard is what produced it. jsdom keeps the bare
// `localStorage` global intact even when `window` is stubbed to undefined,
// so if the `typeof window === 'undefined'` check were deleted entirely
// (not merely inverted), getInstances()'s try/catch would swallow the
// resulting call and still coincidentally return [DEFAULT_INSTANCE], and
// getActiveInstanceId() (no try/catch) would only fail via an uncaught
// TypeError rather than a clean assertion mismatch. Spying on
// localStorage.getItem and asserting it was never called makes guard
// REMOVAL fail the test directly, regardless of any try/catch downstream.

describe('getInstances – SSR guard (typeof window === "undefined")', () => {
  it('returns [DEFAULT_INSTANCE] without touching localStorage when window is undefined', () => {
    // Spy on Storage.prototype (not the localStorage instance): jsdom's
    // Storage implements Web IDL "legacy platform object" semantics, where
    // assigning/spying directly on the instance's getItem does not actually
    // intercept real calls made through it.
    const getItemSpy = vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem')
    vi.stubGlobal('window', undefined)
    try {
      expect(instanceLib.getInstances()).toEqual([DEFAULT_INSTANCE])
      expect(getItemSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      getItemSpy.mockRestore()
    }
  })

  it('getActiveInstanceId returns null without touching localStorage when window is undefined', () => {
    // Spy on Storage.prototype (not the localStorage instance): jsdom's
    // Storage implements Web IDL "legacy platform object" semantics, where
    // assigning/spying directly on the instance's getItem does not actually
    // intercept real calls made through it.
    const getItemSpy = vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem')
    vi.stubGlobal('window', undefined)
    try {
      expect(instanceLib.getActiveInstanceId()).toBeNull()
      expect(getItemSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      getItemSpy.mockRestore()
    }
  })
})
