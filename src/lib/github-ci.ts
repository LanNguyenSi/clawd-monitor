export interface CheckRun {
  status: string
  conclusion: string | null
}

export type CiStatus = 'success' | 'failure' | 'pending' | 'unknown'

const FAILING = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])
const PASSING = new Set(['success', 'neutral', 'skipped'])

/** Fold the check runs of a commit into one CI status. */
export function summarizeCheckRuns(runs: CheckRun[]): CiStatus {
  if (runs.length === 0) return 'unknown'
  if (runs.some((r) => r.status === 'completed' && r.conclusion !== null && FAILING.has(r.conclusion))) return 'failure'
  if (runs.some((r) => r.status !== 'completed' || r.conclusion === null)) return 'pending'
  if (runs.every((r) => r.conclusion !== null && PASSING.has(r.conclusion))) return 'success'
  return 'unknown'
}
