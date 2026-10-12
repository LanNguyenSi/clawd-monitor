/**
 * Display rules for the Docker widget.
 *
 * `restarts` is the agent's real restart count (`docker inspect` RestartCount)
 * and is absent when the agent could not read it. Containers that never
 * restarted (0) show no badge.
 */
export function restartBadge(restarts: unknown): { text: string; title: string } | null {
  if (typeof restarts !== 'number' || !Number.isFinite(restarts) || restarts <= 0) return null
  return {
    text: `↺${restarts}`,
    title: `${restarts} ${restarts === 1 ? 'restart' : 'restarts'}`,
  }
}

/** `uptime` holds the time since the container was created (`docker ps` RunningFor), e.g. "2 hours ago". */
export function createdLabel(uptime: unknown): string {
  return typeof uptime === 'string' && uptime !== '' ? `created ${uptime}` : ''
}
