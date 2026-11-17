import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(snippet).toContain('sudo --preserve-env=CLAWD_AGENT_TOKEN bash -s --')
    expect(snippet).toContain("--server 'wss://monitor.example.com'")
  })

  it('hands the token to the installer through the environment of sudo', () => {
    const snippet = buildInstallSnippet(base)
    expect(snippet).toContain("| CLAWD_AGENT_TOKEN='abc123' sudo --preserve-env=CLAWD_AGENT_TOKEN bash -s -- \\")
  })

  it('never puts the token, or a --token flag, on a command line', () => {
    for (const name of [undefined, 'my-agent']) {
      const snippet = buildInstallSnippet({ ...base, token: 'SECRET_TOKEN_VALUE', name })
      expect(snippet).not.toContain('--token')
      // Everything after `sudo` is the argv of the installer, visible in ps.
      const argv = snippet.slice(snippet.indexOf('sudo '))
      expect(argv).not.toContain('SECRET_TOKEN_VALUE')
      // The token appears once, as the environment assignment before sudo.
      expect(snippet.split('SECRET_TOKEN_VALUE')).toHaveLength(2)
      expect(snippet).toContain("CLAWD_AGENT_TOKEN='SECRET_TOKEN_VALUE' sudo")
    }
  })

  it('quotes a token with shell metacharacters in the environment assignment', () => {
    const snippet = buildInstallSnippet({ ...base, token: "a'b; rm -rf /" })
    expect(snippet).toContain("CLAWD_AGENT_TOKEN='a'\\''b; rm -rf /' sudo")
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
    const serverLine = lines.find((l) => l.includes('--server'))
    expect(serverLine).toMatch(/\\$/)
    expect(lines[lines.length - 1]).toBe("      --name 'agent-01'")
  })

  it('ends on the --server line without a trailing backslash when there is no name', () => {
    const lines = buildInstallSnippet(base).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[lines.length - 1]).not.toMatch(/\\$/)
  })

  it('converts http origin to ws:// in snippet', () => {
    const snippet = buildInstallSnippet({ ...base, origin: 'http://192.168.1.10:9500' })
    expect(snippet).toContain("--server 'ws://192.168.1.10:9500'")
  })

  // Runs the generated text through real bash with a stub `curl` (emits an
  // "installer" that prints what it received) and a stub `sudo` (checks that
  // the variable is passed through and runs the command). Nothing is installed.
  it.skipIf(process.platform === 'win32')('evaluated by bash, the installer receives the token in its environment and not in its argv', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawd-snippet-'))
    try {
      writeFileSync(
        join(dir, 'curl'),
        '#!/bin/bash\ncat <<\'SCRIPT\'\nprintf "env=%s\\n" "${CLAWD_AGENT_TOKEN-unset}"\nprintf "argv=%s\\n" "$*"\nSCRIPT\n',
      )
      writeFileSync(
        join(dir, 'sudo'),
        '#!/bin/bash\nif [ "$1" != "--preserve-env=CLAWD_AGENT_TOKEN" ]; then echo "sudo did not preserve the variable: $*" >&2; exit 9; fi\nshift\nexec "$@"\n',
      )
      chmodSync(join(dir, 'curl'), 0o755)
      chmodSync(join(dir, 'sudo'), 0o755)
      const snippet = buildInstallSnippet({ ...base, token: 'tok-from-env-1', name: "worker's box" })
      const r = spawnSync('bash', ['-c', snippet], {
        env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
        encoding: 'utf-8',
        timeout: 20_000,
      })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('env=tok-from-env-1\n')
      expect(r.stdout).toContain("argv=--server wss://monitor.example.com --name worker's box\n")
      expect(r.stdout).not.toMatch(/argv=.*tok-from-env-1/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
