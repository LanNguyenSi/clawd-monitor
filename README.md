# 🐾 clawd-monitor

![CI](https://github.com/LanNguyenSi/clawd-monitor/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Monitoring dashboard for [OpenClaw](https://openclaw.ai) instances. Connect multiple agents — each pushes live snapshots every 5 seconds via WebSocket. No inbound ports required on agent hosts.

**Live:** [clawd-monitor.opentriologue.ai](https://clawd-monitor.opentriologue.ai)

---

## Widgets

| Widget | Description |
|--------|-------------|
| CPU + RAM | Live metrics with sparklines |
| Agent Status | Active sessions + model info |
| Connected Agents | All connected agents with online/offline status |
| Session Log | Last 5 messages per session (embedded in snapshot) |
| Memory Viewer | Read MEMORY.md / CURRENT.md / today's log from agent |
| Cron Jobs | Scheduled jobs with next/last run times |
| Docker Containers | Container status, restarts, uptime |
| Log Tail | Live log stream (local server) |
| GitHub PRs | Open PRs with CI status |
| Heartbeat Pulse | Agent heartbeat health check |
| Service Health | HTTP health checks for configured services |
| Alert History | Recent alerts from the last 7 days |

All widgets support **agent switching** — select an agent in the navbar to view its data.

---

## Architecture

```
OpenClaw Host (any VPS)               clawd-monitor server
┌──────────────────────┐               ┌──────────────────────┐
│  clawd-monitor-agent │──WebSocket──▶ │  Next.js + WS server │
│  pushes snapshots    │               │  serves dashboard    │
│  every 5 seconds     │               │                      │
└──────────────────────┘               └──────────────────────┘
```

Snapshots include: sessions, cron jobs, metrics, memory files, Docker containers, and recent session messages. All data is pushed from the agent — the server never needs to reach back to the agent host.

Agent repo: [clawd-monitor-agent](https://github.com/LanNguyenSi/clawd-monitor-agent)

---

## Quick Start

### 1. Run clawd-monitor (server)

```bash
git clone https://github.com/LanNguyenSi/clawd-monitor
cd clawd-monitor
cp .env.example .env
# edit .env: set ADMIN_PASSWORD, JWT_SECRET

docker compose -f docker-compose.traefik.yml up -d
```

Open `https://your-domain/` and sign in with the admin password from `.env`.
If you set `ADMIN_PASSWORD_HASH` instead, use the matching plaintext password when logging in.
After the first login, open `Settings` in the UI to change the admin password.
That UI password change is persisted in `CLAWD_MONITOR_DATA_DIR` and becomes the active login password.
Then generate an agent token from `Settings`.

### 2. Connect an agent

On each OpenClaw host you want to monitor:

```bash
npm install -g clawd-monitor-agent
clawd-monitor-agent \
  --server https://your-clawd-monitor-domain \
  --token <token-from-settings> \
  --name "My OpenClaw Host" \
  --gateway http://localhost:18789
```

Or copy the install snippet directly from the Settings page.

---

## Environment Variables

```env
# Required
ADMIN_PASSWORD=             # plaintext, or use ADMIN_PASSWORD_HASH (bcrypt)
JWT_SECRET=                 # random 32+ char string

# Optional
AGENT_TOKENS=token1,token2  # static tokens (also manageable via Settings UI)
NEXT_PUBLIC_DEFAULT_GATEWAY_URL=http://localhost:18789
CLAWD_MONITOR_DATA_DIR=/data   # persistent storage for tokens + password hash
GITHUB_TOKEN=               # for GitHub PR widget
```

---

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

### Make Targets

```bash
make install       # Install dependencies
make dev           # Start dev server
make build         # Production build
make typecheck     # TypeScript type check
make docker-build  # Build Docker image
make docker-up     # Start via Docker Compose
make docker-down   # Stop Docker Compose
make clean         # Remove build artifacts
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `r` | Refresh |
| `e` | Toggle edit mode (drag/resize/close widgets) |
| `t` | Toggle dark/light mode |
| `s` | Screenshot |
| `?` | Show shortcuts |

---

## Stack

- [Next.js 15](https://nextjs.org) — App Router + custom WebSocket server
- [TypeScript](https://www.typescriptlang.org) strict mode
- [Tailwind CSS](https://tailwindcss.com) with dark mode
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) — drag & drop grid
- [SWR](https://swr.vercel.app) — data fetching
- Docker + Traefik for deployment

---

*Built by Ice 🧊 + Lava 🌋 for the [OpenClaw](https://openclaw.ai) ecosystem*
