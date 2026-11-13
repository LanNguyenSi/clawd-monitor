# Widgets

Reference for the dashboard widgets and the keyboard shortcuts that control the
grid. For where each widget gets its data, see [Data sources](#data-sources)
below and [ARCHITECTURE.md](ARCHITECTURE.md).

## Available widgets

| Widget | Description |
|--------|--------------|
| CPU + RAM | Live metrics with sparklines |
| Agent Status | Active sessions and model info |
| Connected Agents | All connected agents with online/offline status |
| Session Log | Last 5 messages per session (embedded in snapshot) |
| Memory Viewer | Reads MEMORY.md / CURRENT.md / today's and yesterday's log from the agent |
| Cron Jobs | Scheduled jobs with next/last run times |
| Docker Containers | Container status, restart count (hidden at 0), time since creation |
| Log Tail | Live log stream (local server) |
| GitHub PRs | Open PRs for the repositories listed in `GITHUB_REPOS`, with a CI dot from the check runs of each PR's head commit (needs `GITHUB_TOKEN`; no repositories configured means the widget shows a hint) |
| Heartbeat Pulse | Agent heartbeat health check |
| Service Health | HEAD checks against the URLs listed in `SERVICE_HEALTH_URLS`; with the variable unset the widget is empty |
| Alert History | Recent alerts from the last 7 days |

Adding a new widget takes a component file in `src/components/widgets/`, an
entry in `src/lib/widgets.ts`, and an entry in `WIDGET_COMPONENTS` in
`src/components/Grid/WidgetGrid.tsx`; see
[CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-widget).

## Data sources

Most widgets follow the agent selected in the navbar. Without a selected
agent, they fall back to the default gateway or to data on the clawd-monitor
host. Four widgets always show the same server-wide data.

| Widget | Agent selected | No agent selected |
|--------|----------------|-------------------|
| CPU + RAM | Agent snapshot `metrics` | `/proc` on the clawd-monitor host (`/api/stream/metrics`) |
| Agent Status | Agent snapshot `sessions` | Default gateway `/sessions` |
| Session Log | Agent snapshot `sessions[].recentMessages` | None, needs an agent |
| Memory Viewer | Agent snapshot `memoryFiles` | Default gateway, then files under `CLAWD_DIR` on the clawd-monitor host |
| Cron Jobs | Agent snapshot `cronJobs` | Default gateway `/cron/jobs` |
| Docker Containers | Agent snapshot `containers` | `docker ps -a` plus one batched `docker inspect` (restart count) on the clawd-monitor host |
| Heartbeat Pulse | Agent snapshot (online state, uptime) | Default gateway `/status` |
| Log Tail | `/api/agents/<id>/logs`: the agent's gateway when its `gatewayUrl` is an allowlisted `https` host and port that resolves only to public addresses (see `ALLOWED_GATEWAY_HOSTS`; the default gateway URL gets no exception), otherwise a "not available" note; the docker and system sources are not available for an agent (the widget offers only OpenClaw while an agent is selected; containers and system logs of the clawd-monitor host are tailed only without an agent selected) | `/api/stream/logs`: default gateway, or local `docker logs`, `journalctl` or syslog |

Connected Agents (agent registry), GitHub PRs (GitHub API), Service Health
(fixed URL list) and Alert History (`CLAWD_DIR/memory/smart-alert-state.json`
on the clawd-monitor host) show the same data whether or not an agent is
selected.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `r` | Refresh |
| `e` | Toggle edit mode (drag/resize/close widgets) |
| `t` | Toggle dark/light mode |
| `?` | Show shortcuts |

### Moving and resizing widgets with the keyboard

The dashboard starts locked. After `e` (or "Edit layout") every widget card is a tab stop that
announces itself as a "movable widget" with the widget title as its name and a visible focus
outline; locked, the cards are not focusable. With the card itself focused (not something inside
it, such as the remove button or a scrolling log):

| Key | Action |
|-----|--------|
| `Arrow` keys | Move the widget by one grid cell. Widgets in the way are pushed aside and the layout is compacted upwards, exactly as after a drag. If one cell changes nothing (for example one row down against a taller widget below), the step grows to the smallest one that does. |
| `Shift` + `Arrow` keys | Resize by one cell: right and down grow the width and height, left and up shrink them. The size stays within the widget's minimum and maximum size and inside the grid columns. |
| `Esc` | Leave the widget (focus moves to the grid container). `Tab` moves on to the next control as usual. |

The move or resize is saved like a drag (browser `localStorage`, per screen-size layout), and a
polite live region announces the result ("CPU + RAM moved to column 3, row 2", "Cron Jobs resized
to 4 by 3", or why nothing moved). The global `e` shortcut keeps working while a card is focused.
