'use client'

import useSWR from 'swr'
import { useActiveAgent } from '@/lib/active-agent'
import type { CronJob } from '@/types'
import { fetcher } from '@/lib/fetcher'

interface CronResponse { jobs?: CronJob[]; error?: string }
interface SnapshotResponse { snapshot?: { cronJobs?: CronJob[] }; online?: boolean; lastSnapshotAt?: number }


function formatNext(ms?: number): string {
  if (!ms) return '—'
  const diff = ms - Date.now()
  if (diff < 0) return 'overdue'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `in ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `in ${m}m`
  return `in ${Math.floor(m / 60)}h`
}

function formatLast(ms?: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

interface ScheduleShape { kind?: string; expr?: string; everyMs?: number }
function scheduleLabel(job: CronJob): string {
  const s = job.schedule as ScheduleShape
  if (s.kind === 'cron') return s.expr ?? 'cron'
  if (s.kind === 'every' && s.everyMs) {
    const m = Math.round(s.everyMs / 60000)
    return m < 60 ? `every ${m}m` : `every ${Math.round(m / 60)}h`
  }
  if (s.kind === 'at') return 'one-shot'
  return s.kind ?? '?'
}

export function CronWidget() {
  const { activeAgentId } = useActiveAgent()

  const snapshotUrl = activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null
  const proxyUrl = !activeAgentId ? '/api/proxy/cron' : null

  const { data: snapshotData, isLoading: snLoading, mutate: mutateSn } = useSWR<SnapshotResponse>(snapshotUrl, fetcher, { refreshInterval: 5_000, revalidateOnFocus: false })
  const { data: proxyData, isLoading: prLoading, mutate: mutateProxy } = useSWR<CronResponse>(proxyUrl, fetcher, { refreshInterval: 30_000 })

  const isLoading = activeAgentId ? snLoading : prLoading
  const agentOffline = activeAgentId && snapshotData && !snapshotData.online
  const jobs: CronJob[] = activeAgentId
    ? (snapshotData?.snapshot?.cronJobs ?? [])
    : (proxyData?.jobs ?? [])
  const errorMsg = !activeAgentId && proxyData?.error

  async function triggerJob(jobId: string) {
    await fetch('/api/proxy/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
    void (activeAgentId ? mutateSn() : mutateProxy())
  }

  if (agentOffline) {
    const lastSeen = snapshotData?.lastSnapshotAt ? (() => { const s = Math.floor((Date.now() - snapshotData.lastSnapshotAt!) / 1000); return s < 60 ? `${s}s ago` : `${Math.floor(s/60)}m ago` })() : '—'
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 px-4">
        <div className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-600" />
        <span className="text-xs text-zinc-500">Agent offline</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-700">last seen {lastSeen}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">Loading…</span>
        </div>
      )}

      {!isLoading && errorMsg && (
        <div className="flex items-center justify-center h-full px-4">
          <div className="text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-600">{errorMsg}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-700 mt-1">Select an agent to view cron jobs</p>
          </div>
        </div>
      )}

      {!isLoading && !errorMsg && jobs.length === 0 && (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-zinc-400 dark:text-zinc-600">No cron jobs</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="overflow-y-auto divide-y divide-zinc-200/50 dark:divide-zinc-800/50 flex-1">
          {jobs.map((job) => (
            <div key={job.id} className="px-3 py-2 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/20 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.enabled ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
                  <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate">{job.name ?? job.id.slice(0, 12)}</span>
                </div>
                <button
                  onClick={() => void triggerJob(job.id)}
                  className="text-xs text-zinc-400 dark:text-zinc-600 hover:text-indigo-500 dark:hover:text-indigo-400 shrink-0 transition-colors"
                  title="Trigger now"
                >▶</button>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">
                <span className="font-mono">{scheduleLabel(job)}</span>
                <span>next: {formatNext(job.state?.nextRunAtMs)}</span>
                <span>last: {formatLast(job.state?.lastRunAtMs)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
