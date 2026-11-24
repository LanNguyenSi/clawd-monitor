import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Guards the tracked env templates: for a key with no value, docker compose
// reads a trailing comment as the value, so "KEY=   # note" sets the value to
// "# note" (after a non-empty value the comment is stripped; the rule below is
// stricter and bans inline comments altogether). An admin password or JWT secret written that way is not
// empty and passes the production startup check with the comment as its
// value, and a placeholder DOMAIN passes the ${DOMAIN:?} guard. So no active
// line of a template may carry an inline comment, the secrets must be bare,
// and DOMAIN must be empty.

const ROOT = resolve(__dirname, '../..')

const KEY_LINE = /^[A-Z_][A-Z0-9_]*=/

// Returns a description per rule the line breaks; [] for blank lines,
// whole-line comments and clean KEY= lines.
function lineProblems(line: string): string[] {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return []
  if (!KEY_LINE.test(line)) {
    return [`not a KEY= line: ${JSON.stringify(line)}`]
  }
  const value = line.slice(line.indexOf('=') + 1)
  // A whitespace-then-# inside the value is read back verbatim by compose.
  if (/\s#/.test(value)) {
    return [`value carries a whitespace-then-# tail compose keeps verbatim: ${JSON.stringify(line)}`]
  }
  return []
}

function templateLines(file: string): string[] {
  return readFileSync(resolve(ROOT, file), 'utf8').split('\n')
}

function templateVars(file: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of templateLines(file)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = line.indexOf('=')
    vars.set(line.slice(0, eq), line.slice(eq + 1))
  }
  return vars
}

describe('the checker', () => {
  it('rejects a whitespace-then-# tail after the = (both shapes compose reads as the value)', () => {
    expect(lineProblems('KEY=   # c')).not.toEqual([])
    expect(lineProblems('KEY=val # c')).not.toEqual([])
  })

  it('accepts blank lines, whole-line comments, a bare key and a plain value', () => {
    expect(lineProblems('')).toEqual([])
    expect(lineProblems('   ')).toEqual([])
    expect(lineProblems('# KEY=val  # c')).toEqual([])
    expect(lineProblems('KEY=')).toEqual([])
    expect(lineProblems('KEY=val')).toEqual([])
  })

  it('rejects active lines that are not KEY= at all', () => {
    expect(lineProblems('export KEY=val')).not.toEqual([])
    expect(lineProblems('lower_case=1')).not.toEqual([])
    expect(lineProblems('KEY')).not.toEqual([])
  })
})

describe.each(['.env.example', '.env.runtime.example'])('%s', (file) => {
  it('has no inline comment on any active line', () => {
    const problems = templateLines(file).flatMap((l) => lineProblems(l))
    expect(problems).toEqual([])
  })
})

describe('.env.example is safe to cp to .env verbatim', () => {
  const vars = templateVars('.env.example')

  it('keeps the secrets bare, so the production startup check refuses an unedited copy', () => {
    expect(vars.get('ADMIN_PASSWORD')).toBe('')
    expect(vars.get('JWT_SECRET')).toBe('')
    expect(vars.get('DEFAULT_GATEWAY_TOKEN')).toBe('')
  })

  it('keeps DOMAIN empty, so ${DOMAIN:?} fails until the operator sets it', () => {
    expect(vars.get('DOMAIN')).toBe('')
  })
})
