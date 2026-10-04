# Widgets

Reference for the dashboard widgets and the keyboard shortcuts that control the
grid. For how a widget gets its data (agent push vs. direct Gateway proxy), see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Available widgets

| Widget | Description |
|--------|--------------|
| CPU + RAM | Live metrics with sparklines |
| Agent Status | Active sessions and model info |
| Connected Agents | All connected agents with online/offline status |
| Session Log | Last 5 messages per session (embedded in snapshot) |
| Memory Viewer | Reads MEMORY.md / CURRENT.md / today's and yesterday's log from the agent |
| Cron Jobs | Scheduled jobs with next/last run times |
| Docker Containers | Container status, restarts, uptime |
| Log Tail | Live log stream (local server) |
| GitHub PRs | Open PRs with CI status |
| Heartbeat Pulse | Agent heartbeat health check |
| Service Health | HTTP health checks for configured services |
| Alert History | Recent alerts from the last 7 days |

All widgets support agent switching: select an agent in the navbar to view its
data.

Adding a new widget is a self-contained change (new file in
`src/components/widgets/` plus a registry entry); see
[CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-widget).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `r` | Refresh |
| `e` | Toggle edit mode (drag/resize/close widgets) |
| `t` | Toggle dark/light mode |
| `s` | Screenshot |
| `?` | Show shortcuts |
