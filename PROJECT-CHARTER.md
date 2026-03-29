# Project Charter: clawd-monitor

## Summary

Web-based monitoring dashboard for OpenClaw instances. Live widgets in a configurable grid layout — log tailing, system metrics, agent status, cron jobs, Docker containers, and more. Multi-instance support, admin login, keyboard shortcuts, persistent layout.

## Problem

Monitoring an OpenClaw instance currently requires SSH + CLI. No visual overview exists. Users who run multiple instances (e.g. laptop + VPS) have no single pane of glass.

## Target Users

- OpenClaw operators (primary: Lan)
- AI agents who want to self-monitor (Ice, Lava)

## Core Features

1. **Widget Grid** — 2/4/8 widget layout, drag & drop, resize, persist to localStorage
2. **Widgets (Wave 1-2):**
   - Log Tail (openclaw logs, docker logs, system journal)
   - CPU + RAM (live sparkline, configurable refresh)
   - Memory Viewer (MEMORY.md live reload, diff view)
   - Agent Status (active sessions, model, last activity)
3. **Widgets (Wave 3):**
   - Cron Overview (list, next run, manual trigger)
   - Docker Containers (status, restart count, uptime)
   - Heartbeat Pulse (last response, OK/WARNING/SILENT)
   - depsight Health (top-5 risk repos)
4. **Widgets (Wave 4):**
   - GitHub PR Status (open PRs, CI status)
   - Service Health (depsight, project-forge, ci-insights response times)
   - Alert History (last 7 days of smart-alert pings)
5. **Multi-Instance** — switch between saved OpenClaw Gateway URLs + tokens in the nav
6. **Admin Login** — JWT, simple password auth
7. **Keyboard Shortcuts** — `1-8` widget focus, `r` refresh, `s` screenshot, `e` edit layout

## Technical Constraints

- Stack: Next.js 15 (App Router) + Tailwind CSS + TypeScript strict
- Real-time: SSE for log streaming + metrics (no polling where avoidable)
- Layout: `react-grid-layout` for drag & drop
- Auth: JWT stored in localStorage
- Backend: OpenClaw Gateway REST API as data source (no new backend)
- Deployment: Docker + Traefik on Stone VPS
- Language: DE for UI, EN for code/comments

## Non-Goals (v1)

- Mobile-optimized layout
- Multi-user auth (single admin only)
- Historical metrics storage (live only, no DB)
- Plugin system for custom widgets

## Success Criteria

- Lan can open the dashboard and see his OpenClaw instance health at a glance
- Layout survives browser refresh
- Switching between 2+ OpenClaw instances works in < 2 seconds
- Log tailing is real-time (< 500ms latency)

## Delivery

| Wave | Content | Owner |
|------|---------|-------|
| 1 | Project scaffold, auth, layout engine, widget grid shell | Lava |
| 2 | Log Tail, CPU/RAM, Memory Viewer, Agent Status widgets | Lava |
| 3 | Cron, Docker, Heartbeat, depsight widgets | Lava |
| 4 | GitHub PR, Service Health, Alert History widgets | Lava |
| 5 | Multi-instance switcher, keyboard shortcuts, screenshot, polish | Lava |
