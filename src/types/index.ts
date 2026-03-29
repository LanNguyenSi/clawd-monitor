export type WidgetSize = '1x1' | '1x2' | '2x1' | '2x2'

export interface Widget {
  id: string
  title: string
  component: string        // component name in registry
  defaultW: number         // grid columns
  defaultH: number         // grid rows
  minW?: number
  minH?: number
}

export interface GridLayout {
  i: string                // widget instance id
  x: number
  y: number
  w: number
  h: number
  widgetId: string         // references Widget.id
}

export interface Instance {
  id: string
  name: string
  gatewayUrl: string
  token: string
}

export type ColCount = 2 | 4 | 8

export interface DashboardState {
  layouts: GridLayout[]
  cols: ColCount
  activeInstanceId: string | null
  widgetInstances: { id: string; widgetId: string }[]
}

export interface GatewaySession {
  sessionKey: string
  kind: string
  model?: string
  lastMessage?: string
  lastActiveAt?: string
}

export interface CronJob {
  id: string
  name?: string
  enabled: boolean
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string }
  state?: { nextRunAtMs?: number; lastRunAtMs?: number }
}

export interface SystemMetrics {
  cpu: number          // 0-100 %
  memUsed: number      // bytes
  memTotal: number     // bytes
  timestamp: number    // unix ms
}
