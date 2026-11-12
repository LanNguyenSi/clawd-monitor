/**
 * resolveDefaultGatewayUrl: DEFAULT_GATEWAY_URL wins, then the deprecated
 * NEXT_PUBLIC_DEFAULT_GATEWAY_URL, then http://localhost:9500. An empty or
 * whitespace-only value counts as unset. Each input combination is a case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveDefaultGatewayUrl } from '@/lib/gateway'

const NEW = 'DEFAULT_GATEWAY_URL'
const OLD = 'NEXT_PUBLIC_DEFAULT_GATEWAY_URL'

/** Set (string) or remove (undefined) the two variables. */
function setEnv(next: string | undefined, old: string | undefined) {
  for (const [k, v] of [[NEW, next], [OLD, old]] as const) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string)
    else vi.stubEnv(k, v)
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('resolveDefaultGatewayUrl', () => {
  it('uses the localhost fallback when neither is set', () => {
    setEnv(undefined, undefined)
    expect(resolveDefaultGatewayUrl()).toBe('http://localhost:9500')
  })

  it('uses DEFAULT_GATEWAY_URL when only it is set', () => {
    setEnv('http://new.internal:1', undefined)
    expect(resolveDefaultGatewayUrl()).toBe('http://new.internal:1')
  })

  it('uses the deprecated name when only it is set', () => {
    setEnv(undefined, 'http://old.internal:2')
    expect(resolveDefaultGatewayUrl()).toBe('http://old.internal:2')
  })

  it('lets DEFAULT_GATEWAY_URL win when both are set', () => {
    setEnv('http://new.internal:1', 'http://old.internal:2')
    expect(resolveDefaultGatewayUrl()).toBe('http://new.internal:1')
  })

  it('treats an empty DEFAULT_GATEWAY_URL as unset and falls back to the deprecated name', () => {
    setEnv('', 'http://old.internal:2')
    expect(resolveDefaultGatewayUrl()).toBe('http://old.internal:2')
  })

  it('treats a whitespace-only DEFAULT_GATEWAY_URL as unset', () => {
    setEnv('   ', 'http://old.internal:2')
    expect(resolveDefaultGatewayUrl()).toBe('http://old.internal:2')
  })

  it('treats an empty deprecated name as unset when the new one is absent', () => {
    setEnv(undefined, '')
    expect(resolveDefaultGatewayUrl()).toBe('http://localhost:9500')
  })

  it('uses the fallback when both are empty', () => {
    setEnv('', '')
    expect(resolveDefaultGatewayUrl()).toBe('http://localhost:9500')
  })

  it('trims surrounding whitespace of the chosen value', () => {
    setEnv('  http://new.internal:1 ', undefined)
    expect(resolveDefaultGatewayUrl()).toBe('http://new.internal:1')
  })
})
