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
  }

  const TOKEN = 'SECRET_TOKEN_VALUE_9f2e61'

  // Passes the token-shaped input through the helper the way the old
  // API did (and the way a re-embedding regression would read it), so
  // any step that embeds the token again carries this exact literal.
  function buildWithTokenLikeInput(opts: { origin: string; name?: string }) {
    const input = { ...opts, token: TOKEN } as Parameters<typeof buildInstallSnippet>[0]
    return buildInstallSnippet(input)
  }

  it('returns step 1 and step 2 as two separate strings', () => {
    const steps = buildInstallSnippet(base)
    expect(typeof steps.promptStep).toBe('string')
    expect(typeof steps.installStep).toBe('string')
    // The steps must stay separate copy blocks: pasted as one block,
    // `read -rs` would consume the curl line as the token.
    expect(steps.promptStep).not.toContain('curl')
    expect(steps.promptStep).not.toContain('install.sh')
    expect(steps.installStep).not.toContain('read -rs')
    expect(steps.installStep).not.toContain('printf')
    expect(steps.installStep).toContain('curl -fsSL')
  })

  it('step 1 is the read -rs prompt line', () => {
    const { promptStep } = buildInstallSnippet(base)
    expect(promptStep).toBe("printf 'Agent token: '; read -rs CLAWD_AGENT_TOKEN; echo; export CLAWD_AGENT_TOKEN")
  })

  it('produces a multi-line curl snippet in step 2', () => {
    const { installStep } = buildInstallSnippet(base)
    expect(installStep).toContain('curl -fsSL')
    expect(installStep).toContain('sudo --preserve-env=CLAWD_AGENT_TOKEN bash -s --')
    expect(installStep).toContain("--server 'wss://monitor.example.com'")
  })

  it('ends step 2 with unset CLAWD_AGENT_TOKEN on the last line of the same logical command', () => {
    for (const name of [undefined, 'my-agent']) {
      const lines = buildInstallSnippet({ ...base, name }).installStep.split('\n')
      const last = lines[lines.length - 1]
      expect(last.endsWith('; unset CLAWD_AGENT_TOKEN')).toBe(true)
      // Never its own line: sudo would read a separate pasted line as a password.
      expect(lines.filter((l) => l.trim() === 'unset CLAWD_AGENT_TOKEN')).toHaveLength(0)
      expect(lines.filter((l) => l.includes('unset'))).toHaveLength(1)
      // Every earlier line continues the command with a backslash.
      for (const l of lines.slice(0, -1)) expect(l).toMatch(/\\$/)
    }
  })

  it('never embeds the token in either step', () => {
    for (const name of [undefined, 'my-agent']) {
      const steps = buildWithTokenLikeInput({ ...base, name })
      expect(steps.promptStep).not.toContain(TOKEN)
      expect(steps.installStep).not.toContain(TOKEN)
      expect(steps.promptStep).not.toContain(shellQuote(TOKEN))
      expect(steps.installStep).not.toContain(shellQuote(TOKEN))
      // No environment assignment and no --token flag either.
      expect(steps.installStep).not.toContain(`CLAWD_AGENT_TOKEN=${TOKEN}`)
      expect(steps.installStep).not.toContain(`CLAWD_AGENT_TOKEN='${TOKEN}'`)
      expect(steps.installStep).not.toContain('--token')
      expect(steps.promptStep).not.toContain('--token')
    }
  })

  it('omits --name when name is not provided', () => {
    const { installStep } = buildInstallSnippet(base)
    expect(installStep).not.toContain('--name')
  })

  it('omits --name when name is blank', () => {
    const { installStep } = buildInstallSnippet({ ...base, name: '   ' })
    expect(installStep).not.toContain('--name')
  })

  it('includes --name when a name is supplied', () => {
    const { installStep } = buildInstallSnippet({ ...base, name: 'my-agent' })
    expect(installStep).toContain("--name 'my-agent'")
  })

  it('trims surrounding whitespace from the name', () => {
    const { installStep } = buildInstallSnippet({ ...base, name: '  box  ' })
    expect(installStep).toContain("--name 'box'")
  })

  it('quotes a name containing an apostrophe', () => {
    const { installStep } = buildInstallSnippet({ ...base, name: "worker's box" })
    expect(installStep).toContain("--name 'worker'\\''s box'")
  })

  it('quotes a name with shell metacharacters', () => {
    const { installStep } = buildInstallSnippet({ ...base, name: 'box; rm -rf /' })
    expect(installStep).toContain("--name 'box; rm -rf /'")
  })

  it('adds a continuation backslash before --name line', () => {
    const lines = buildInstallSnippet({ ...base, name: 'agent-01' }).installStep.split('\n')
    const serverLine = lines.find((l) => l.includes('--server'))
    expect(serverLine).toMatch(/\\$/)
    expect(lines[lines.length - 1]).toBe("      --name 'agent-01'; unset CLAWD_AGENT_TOKEN")
  })

  it('ends the pipeline on the --server line without a trailing backslash when there is no name', () => {
    const lines = buildInstallSnippet(base).installStep.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).not.toMatch(/\\$/)
  })

  it('converts http origin to ws:// in snippet', () => {
    const { installStep } = buildInstallSnippet({ origin: 'http://192.168.1.10:9500' })
    expect(installStep).toContain("--server 'ws://192.168.1.10:9500'")
  })

  // Runs the generated steps through real bash the way the operator
  // uses them: paste step 1 and type the token (fed on stdin), then
  // paste step 2. Stub `curl` emits an "installer" that prints what it
  // received; stub `sudo` checks the variable is passed through and
  // runs the command. Nothing is installed.
  it.skipIf(process.platform === 'win32')(
    'evaluated by bash, the installer receives the token in its environment and not in its argv, and step 2 leaves no token in the shell',
    () => {
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
        const steps = buildInstallSnippet({ ...base, name: "worker's box" })
        const script = `${steps.promptStep}\n${steps.installStep}\nprintf "token_after=${'${CLAWD_AGENT_TOKEN-cleared}'}\\n"\n`
        const r = spawnSync('bash', ['-c', script], {
          input: 'tok-from-env-1\n',
          env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
          encoding: 'utf-8',
          timeout: 20_000,
        })
        expect(r.status, r.stderr).toBe(0)
        // Step 1 put the typed token into the environment; step 2's
        // sudo --preserve-env handed it to the installer.
        expect(r.stdout).toContain('env=tok-from-env-1\n')
        expect(r.stdout).toContain("argv=--server wss://monitor.example.com --name worker's box\n")
        expect(r.stdout).not.toMatch(/argv=.*tok-from-env-1/)
        // Step 2's trailing unset cleared the variable from the shell.
        expect(r.stdout).toContain('token_after=cleared\n')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
