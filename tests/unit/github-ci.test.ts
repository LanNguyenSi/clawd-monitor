import { describe, it, expect } from 'vitest'
import { summarizeCheckRuns } from '@/lib/github-ci'

const done = (conclusion: string) => ({ status: 'completed', conclusion })

describe('summarizeCheckRuns', () => {
  it('is unknown without check runs', () => {
    expect(summarizeCheckRuns([])).toBe('unknown')
  })
  it('is success when all runs passed, neutral or skipped', () => {
    expect(summarizeCheckRuns([done('success'), done('neutral'), done('skipped')])).toBe('success')
  })
  it('is failure when any completed run failed, even if others are pending', () => {
    expect(summarizeCheckRuns([done('success'), done('failure'), { status: 'in_progress', conclusion: null }])).toBe('failure')
  })
  it('is pending when a run has not completed and none failed', () => {
    expect(summarizeCheckRuns([done('success'), { status: 'queued', conclusion: null }])).toBe('pending')
  })
  it('treats timed_out and cancelled as failure', () => {
    expect(summarizeCheckRuns([done('timed_out')])).toBe('failure')
    expect(summarizeCheckRuns([done('cancelled')])).toBe('failure')
  })
})
