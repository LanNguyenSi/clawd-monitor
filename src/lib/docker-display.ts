/**
 * Display rules for the Docker widget.
 *
 * `restarts` is the real restart count (`docker inspect` RestartCount), from
 * the agent or the host proxy, and is absent when it could not be read.
 * Containers that never restarted (0) show no badge.
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
