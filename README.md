# 🐾 clawd-monitor

![CI](https://github.com/LanNguyenSi/clawd-monitor/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Web-based monitoring dashboard for [OpenClaw](https://openclaw.ai) instances.

Live widgets in a configurable drag-and-drop grid. Connect multiple OpenClaw agents — each pushes live snapshots every 5 seconds. No inbound ports required on agent hosts.

**Live:** [clawd-monitor.opentriologue.ai](https://clawd-monitor.opentriologue.ai)

---

## Features

- **Push-based agent model** — agents connect outbound, no exposed ports
- **10 live widgets** — CPU/RAM, Sessions, Cron Jobs, Docker Containers, Log Tail, Heartbeat, Service Health, GitHub PRs, Alert History, Connected Agents
- **Drag & drop layout** — 2/4/8 column grid, persisted to localStorage
- **Agent switcher in Navbar** — switch between Ice, Lava, any connected OpenClaw host
- **Token management** — generate, revoke, install-snippet per agent
- **Settings page** — change password, manage tokens
- **Keyboard shortcuts** — `r` refresh, `s` screenshot, `t` dark/light, `e` edit layout, `?` help

---

## Architecture

```
OpenClaw Host (Ice VPS)               Stone VPS
┌─────────────────────┐               ┌──────────────────────┐
│  clawd-monitor-     │               │  clawd-monitor       │
│  agent              │──WebSocket──▶ │  (this repo)         │
│  pushes snapshots   │               │  shows dashboard     │
└─────────────────────┘               └──────────────────────┘
```

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

Open `https://your-domain/` → login → Settings → generate an agent token.

### 2. Connect an agent (on each OpenClaw host)

```bash
npm install -g clawd-monitor-agent
clawd-monitor-agent \
  --server https://your-clawd-monitor-domain \
  --token <token-from-settings> \
  --name "My OpenClaw Host"
```

Or copy the install snippet directly from the Settings page.

---

## Environment Variables

```env
# Required
ADMIN_PASSWORD=             # or ADMIN_PASSWORD_HASH (bcrypt)
JWT_SECRET=                 # random 32+ char string

# Agent tokens (comma-separated, for backward compat)
AGENT_TOKENS=token1,token2  # also manageable via Settings UI

# Optional
NEXT_PUBLIC_DEFAULT_GATEWAY_URL=http://localhost:9500
CLAWD_MONITOR_DATA_DIR=/data   # persistent storage (tokens, password)
CLAWD_DIR=/root/.openclaw/workspace  # for Memory Viewer (if running locally)
GITHUB_TOKEN=               # for GitHub PR widget
```

---

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

---

## Stack

- [Next.js 15](https://nextjs.org) (App Router, custom server for WebSocket)
- [TypeScript](https://www.typescriptlang.org) strict mode
- [Tailwind CSS](https://tailwindcss.com)
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)
- [SWR](https://swr.vercel.app) for data fetching
- Docker + Traefik for deployment

---

## Contributing

PRs welcome. Branch naming: `feat/<task-id>-<name>`. Build must pass before opening PR.

---

*Built by Ice 🧊 (spec/review/deploy) + Lava 🌋 (implementation)*  
*A tool for the [OpenClaw](https://openclaw.ai) ecosystem*
