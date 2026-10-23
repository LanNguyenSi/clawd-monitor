import { describe, it, expect } from 'vitest'
import { isValidContainerName, parseGitHubRepo } from '@/lib/input-validators'

describe('isValidContainerName', () => {
  it.each(['web', 'my-app_1.2', 'A1', '0abc', 'a', 'clawd-monitor-agent.v2'])('accepts %s', (name) => {
    expect(isValidContainerName(name)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['leading dash (option)', '-v'],
    ['long option', '--since=1h'],
    ['option separator', '--'],
    ['leading dot', '.hidden'],
    ['leading underscore', '_x'],
    ['space', 'a b'],
    ['semicolon', 'a;b'],
    ['slash', 'a/b'],
    ['path traversal', '../x'],
    ['newline', 'a\nb'],
    ['trailing newline', 'web\n'],
    ['non-ASCII', 'café'],
  ])('rejects %s', (_label, name) => {
    expect(isValidContainerName(name)).toBe(false)
  })
})

describe('parseGitHubRepo', () => {
  it('splits owner/repo', () => {
    expect(parseGitHubRepo('octo/one')).toEqual({ owner: 'octo', repo: 'one' })
    expect(parseGitHubRepo('Octo-Cat_1/repo.name-2')).toEqual({ owner: 'Octo-Cat_1', repo: 'repo.name-2' })
  })

  it.each([
    ['no slash', 'octo'],
    ['empty owner', '/one'],
    ['empty repo', 'octo/'],
    ['three segments', 'a/b/c'],
    ['dot-dot owner', '../one'],
    ['dot-dot repo', 'octo/..'],
    ['single-dot repo', 'octo/.'],
    ['space', 'oc to/one'],
    ['query character', 'octo/one?x=1'],
    ['encoded slash', 'octo%2Fx/one'],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(parseGitHubRepo(value)).toBeNull()
  })
})
