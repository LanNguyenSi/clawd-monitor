import type { Widget } from '@/types'

export const WIDGET_REGISTRY: Widget[] = [
  { id: 'log-tail',       title: 'Log Tail',          component: 'LogTailWidget',       defaultW: 2, defaultH: 3, minW: 2, minH: 2 },
  { id: 'metrics',        title: 'CPU + RAM',          component: 'MetricsWidget',       defaultW: 1, defaultH: 2, minW: 1, minH: 2 },
  // Memory Viewer disabled — needs Gateway API integration (Wave 7)
  { id: 'memory',      title: 'Memory Viewer',      component: 'MemoryWidget',        defaultW: 2, defaultH: 3, minW: 1, minH: 2 },
  { id: 'agent-status',   title: 'Agent Status',       component: 'AgentStatusWidget',   defaultW: 2, defaultH: 2, minW: 1, minH: 2 },
  { id: 'cron',           title: 'Cron Jobs',          component: 'CronWidget',          defaultW: 2, defaultH: 2, minW: 1, minH: 2 },
  { id: 'docker',         title: 'Docker Containers',  component: 'DockerWidget',        defaultW: 2, defaultH: 2, minW: 1, minH: 2 },
  { id: 'heartbeat',      title: 'Heartbeat Pulse',    component: 'HeartbeatWidget',     defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'service-health', title: 'Service Health',     component: 'ServiceHealthWidget', defaultW: 1, defaultH: 2, minW: 1, minH: 1 },
  { id: 'github-prs',     title: 'GitHub PRs',         component: 'GitHubPRWidget',      defaultW: 2, defaultH: 2, minW: 1, minH: 2 },
  { id: 'alert-history',  title: 'Alert History',      component: 'AlertHistoryWidget',  defaultW: 1, defaultH: 2, minW: 1, minH: 1 },
  { id: 'agent-list',    title: 'Connected Agents',   component: 'AgentListWidget',     defaultW: 2, defaultH: 2, minW: 1, minH: 1 },
]

export function getWidget(id: string): Widget | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === id)
}
