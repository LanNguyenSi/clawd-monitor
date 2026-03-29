# clawd-monitor

Web-based monitoring dashboard for OpenClaw instances.

Live widgets in a configurable drag-and-drop grid — log tailing, system metrics, agent status, cron jobs, Docker containers, and more. Multi-instance support, admin login, keyboard shortcuts.

**Status:** 🚧 In development — Wave 1

## Features (planned)

- **Widget Grid** — 2/4/8 column layouts, drag & drop, resize, persisted layout
- **Log Tail** — real-time SSE log streaming (openclaw, docker, system)
- **CPU + RAM** — live sparkline metrics
- **Memory Viewer** — MEMORY.md live reload
- **Agent Status** — active OpenClaw sessions
- **Cron Overview** — scheduled jobs, manual trigger
- **Docker Containers** — container health at a glance
- **GitHub PR Status** — open PRs + CI status
- **Multi-Instance** — switch between OpenClaw deployments
- **Keyboard Shortcuts** — `1-8`, `r`, `s`, `e`, `?`

## Tech Stack

- Next.js 15 (App Router, Server + Client Components)
- TypeScript strict mode
- Tailwind CSS
- react-grid-layout (drag & drop)
- SWR (data fetching)
- SSE for real-time streaming

## Development

```bash
npm install
cp .env.example .env.local
# edit .env.local

npm run dev
```

## Deployment

Docker + Traefik. Target: `clawd-monitor.opentriologue.ai`

```bash
docker compose -f docker-compose.traefik.yml up -d
```

---

*Built by Ice 🧊 (spec/review/deploy) + Lava 🌋 (implementation) — a gift for Lan*
