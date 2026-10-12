import { describe, it, expect } from 'vitest'
import { restartBadge, createdLabel } from '@/lib/docker-display'

describe('restartBadge', () => {
  it('shows the real count when it is a positive number', () => {
    expect(restartBadge(3)).toEqual({ text: '↺3', title: '3 restarts' })
  })

  it('uses the singular title for one restart', () => {
    expect(restartBadge(1)).toEqual({ text: '↺1', title: '1 restart' })
  })

  it('hides the badge at zero', () => {
    expect(restartBadge(0)).toBeNull()
  })

  it.each([undefined, null, '3', NaN, Infinity, -1])('hides the badge for non-count value %s', (v) => {
    expect(restartBadge(v)).toBeNull()
  })
})

describe('createdLabel', () => {
  it('labels the value as time since creation', () => {
    expect(createdLabel('2 hours ago')).toBe('created 2 hours ago')
  })

  it.each(['', undefined, null, 5])('returns an empty label for %s', (v) => {
    expect(createdLabel(v)).toBe('')
  })
})
