# Architecture: clawd-monitor

## Overview

```
Browser
  └── Next.js App (SSR + Client Components)
        ├── /login              → JWT auth
        ├── /dashboard          → Widget grid
        └── /api/
              ├── /api/auth/    → Login endpoint
              ├── /api/proxy/   → Proxies requests to OpenClaw Gateway
              └── /api/stream/  → SSE streams (logs, metrics)

OpenClaw Gateway (remote)
  └── REST API (port 9500 or configured URL)
        ├── GET /sessions       → Active sessions
        ├── GET /cron/jobs      → Cron jobs
        ├── GET /logs/stream    → Log SSE (if available)
        └── ...
```

## Key Decisions

### ADR-001: No New Backend
Data comes from OpenClaw Gateway API directly. Next.js API routes act as authenticated proxy — they add the Gateway token and forward requests. No new database, no new service.

**Why:** Minimal infrastructure. The Gateway already has everything we need.

### ADR-002: SSE over WebSockets for Streaming
Log tailing and metrics use SSE (Server-Sent Events) from Next.js API routes. The route reads from the OpenClaw Gateway (polling or streaming) and pushes to the client.

**Why:** SSE is simpler, works through HTTP/2, no upgrade required. Sufficient for log tailing.

### ADR-003: react-grid-layout for Widget Grid
Industry standard for React drag-and-drop grids. Supports resize, persist layout as JSON.

**Layout configs:** `{ cols: 2 | 4 | 8, rowHeight: 150 }` — user selects from navbar.

### ADR-004: Multi-Instance via Saved Configs
Instances stored in localStorage as `{ name, gatewayUrl, token }[]`. Switcher in nav selects active instance. All API proxy routes use the active instance config.

**No server-side instance state** — purely client-driven.

### ADR-005: Widget Registry Pattern
Each widget is a self-contained React component that:
1. Declares its metadata (`id`, `title`, `defaultSize`)
2. Fetches its own data via SWR or SSE
3. Renders independently

New widgets = new file in `components/widgets/`. No changes to core grid.

## Directory Structure

```
clawd-monitor/
├── app/
│   ├── (auth)/login/          → Login page
│   ├── dashboard/             → Main grid page
│   ├── api/
│   │   ├── auth/route.ts      → POST /api/auth (login → JWT)
│   │   ├── proxy/[...path]/route.ts  → GET/POST proxy to Gateway
│   │   └── stream/[type]/route.ts   → SSE: logs, metrics
│   └── layout.tsx
├── components/
│   ├── Grid/                  → WidgetGrid, GridItem, LayoutControls
│   └── widgets/
│       ├── LogTailWidget.tsx
│       ├── MetricsWidget.tsx
│       ├── MemoryWidget.tsx
│       ├── AgentStatusWidget.tsx
│       ├── CronWidget.tsx
│       ├── DockerWidget.tsx
│       └── ...
├── lib/
│   ├── auth.ts                → JWT sign/verify
│   ├── gateway.ts             → Gateway API client
│   ├── instance.ts            → Multi-instance store (localStorage)
│   └── widgets.ts             → Widget registry
├── types/
│   └── index.ts               → Shared types
├── prisma/                    → NOT USED (no DB)
├── Dockerfile
├── docker-compose.traefik.yml
└── .env.example
```

## Environment Variables

```env
# Required
ADMIN_PASSWORD=<hashed>          # bcrypt hash of admin password
JWT_SECRET=<random-32-char>      # JWT signing secret
NEXT_PUBLIC_DEFAULT_GATEWAY_URL= # Default OpenClaw gateway URL

# Optional (can be configured per-instance in the UI)
DEFAULT_GATEWAY_TOKEN=           # Default API token
```

## Deployment

Same pattern as depsight — Docker + Traefik on Stone VPS.

Target URL: `clawd-monitor.opentriologue.ai`

Dockerfile: multi-stage (deps → builder → runner), `node:20-slim`.
