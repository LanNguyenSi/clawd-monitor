import { describe, it, expect } from 'vitest'
import {
  originToWs,
  shellQuote,
  buildInstallSnippet,
} from '@/lib/install-snippet'

describe('originToWs', () => {
  it('converts https:// to wss://', () => {
    expect(originToWs('https://example.com')).toBe('wss://example.com')
  })

  it('converts http:// to ws://', () => {
    expect(originToWs('http://localhost:3000')).toBe('ws://localhost:3000')
  })

  it('returns unknown schemes unchanged', () => {
    expect(originToWs('ftp://example.com')).toBe('ftp://example.com')
  })

  it('returns an empty string unchanged', () => {
    expect(originToWs('')).toBe('')
  })
})

describe('shellQuote', () => {
  it('wraps a simple value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes', () => {
    // "it's" → 'it'\''s'
    expect(shellQuote("it's a test")).toBe("'it'\\''s a test'")
  })

  it('handles a value that is only an apostrophe', () => {
    expect(shellQuote("'")).toBe("''\\'''")
  })

  it('handles values with spaces and shell metacharacters', () => {
    expect(shellQuote('hello world; rm -rf /')).toBe("'hello world; rm -rf /'")
  })

  it('handles hex tokens without modification', () => {
    const token = 'abc123def456'
    expect(shellQuote(token)).toBe(`'${token}'`)
  })
})

describe('buildInstallSnippet', () => {
  const base = {
    origin: 'https://monitor.example.com',
    token: 'abc123',
  }

  it('produces a multi-line curl snippet', () => {
    const snippet = buildInstallSnippet(base)
    expect(snippet).toContain('curl -fsSL')
    expect(snippet).toContain('sudo bash -s --')
    expect(snippet).toContain("--server 'wss://monitor.example.com'")
    expect(snippet).toContain("--token 'abc123'")
  })

  it('omits --name when name is not provided', () => {
    const snippet = buildInstallSnippet(base)
    expect(snippet).not.toContain('--name')
  })

  it('omits --name when name is blank', () => {
    const snippet = buildInstallSnippet({ ...base, name: '   ' })
    expect(snippet).not.toContain('--name')
  })

  it('includes --name when a name is supplied', () => {
    const snippet = buildInstallSnippet({ ...base, name: 'my-agent' })
    expect(snippet).toContain("--name 'my-agent'")
  })

  it('quotes a name containing an apostrophe', () => {
    const snippet = buildInstallSnippet({ ...base, name: "worker's box" })
    expect(snippet).toContain("--name 'worker'\\''s box'")
  })

  it('adds a continuation backslash before --name line', () => {
    const snippet = buildInstallSnippet({ ...base, name: 'agent-01' })
    const lines = snippet.split('\n')
    const tokenLine = lines.find((l) => l.includes('--token'))
    expect(tokenLine).toMatch(/\\$/)
  })

  it('converts http origin to ws:// in snippet', () => {
    const snippet = buildInstallSnippet({ ...base, origin: 'http://192.168.1.10:9500' })
    expect(snippet).toContain("--server 'ws://192.168.1.10:9500'")
  })
})
