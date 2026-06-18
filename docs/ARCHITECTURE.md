# Architecture: clawd-monitor

## Overview

clawd-monitor runs on a custom Next.js server (`server.ts`) that serves the
dashboard and also accepts agent WebSocket connections. Two data paths coexist:

1. **Agent push (primary):** remote `clawd-monitor-agent` processes connect to
   `/api/agents/ws` and push periodic snapshots. The server keeps them in an
   in-memory registry; widgets read the latest snapshot. No inbound port is
   needed on the agent host.
2. **Direct proxy (legacy/optional):** when no agent is selected, API routes
   under `/api/proxy/*` and `/api/stream/*` reach an OpenClaw Gateway directly.

```
clawd-monitor-agent (remote host)
  └── WebSocket ──▶ /api/agents/ws  → auth + snapshot push → agent registry

Browser
  └── Next.js App (SSR + Client Components)
        ├── /login              → JWT auth
        ├── /dashboard          → Widget grid
        └── /api/
              ├── /api/auth/                  → Login endpoint
              ├── /api/agents/list            → Connected agents (from registry)
              ├── /api/agents/[id]/snapshot   → Latest snapshot for an agent
              ├── /api/proxy/                 → Direct proxy to OpenClaw Gateway
              └── /api/stream/                → SSE streams (logs, metrics)

OpenClaw Gateway (remote, direct-proxy path only)
  └── REST API (port 9500 or configured URL)
        ├── GET /sessions       → Active sessions
        ├── GET /cron/jobs      → Cron jobs
        ├── GET /logs/stream    → Log SSE (if available)
        └── ...
```

The agent WebSocket protocol (handshake, snapshot shape, TTL) is documented in
[AGENT-PROTOCOL.md](AGENT-PROTOCOL.md).

## Key Decisions

### ADR-001: No New Backend
Data comes from OpenClaw Gateway API directly. Next.js API routes act as authenticated proxy — they add the Gateway token and forward requests. No new database, no new service.

**Why:** Minimal infrastructure. The Gateway already has everything we need.

**Update (agent-push model):** the direct-proxy path is still supported, but the
primary data path is now agent push over WebSocket. A custom server
(`server.ts`) accepts agent connections and an in-memory registry
(`src/lib/agent-registry.ts`) holds the latest snapshot per agent. This is still
"no new database" — the registry is process-memory only with a TTL.

### ADR-002: SSE over WebSockets for Streaming
Log tailing and metrics use SSE (Server-Sent Events) from Next.js API routes. The route reads from the OpenClaw Gateway (polling or streaming) and pushes to the client.

**Why:** SSE is simpler, works through HTTP/2, no upgrade required. Sufficient for log tailing.

**Update (agent-push model):** browser-facing streaming still uses SSE, but
agent-to-server transport is now a WebSocket (`/api/agents/ws`, handled in
`server.ts` via the `ws` package), because agents push bidirectional,
long-lived snapshot/ping traffic that SSE does not fit.

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

New widgets = new file in `src/components/widgets/`. No changes to core grid.

## Directory Structure

```
clawd-monitor/
├── server.ts                  → Custom Next.js server + agent WebSocket upgrade (/api/agents/ws)
├── src/
│   ├── app/
│   │   ├── (auth)/login/      → Login page
│   │   ├── dashboard/         → Main grid page
│   │   ├── settings/          → Settings (admin password, agent tokens)
│   │   ├── api/
│   │   │   ├── auth/route.ts                       → POST /api/auth (login → JWT)
│   │   │   ├── agents/list/route.ts                → GET connected agents (JWT)
│   │   │   ├── agents/[agentId]/snapshot/route.ts  → GET latest agent snapshot (JWT)
│   │   │   ├── proxy/[...path]/route.ts            → GET/POST proxy to Gateway
│   │   │   ├── stream/logs/route.ts                → SSE: logs
│   │   │   └── stream/metrics/route.ts             → SSE: metrics
│   │   └── layout.tsx
│   ├── components/
│   │   ├── Grid/              → WidgetGrid, GridItem
│   │   └── widgets/
│   │       ├── LogTailWidget.tsx
│   │       ├── MetricsWidget.tsx
│   │       ├── MemoryWidget.tsx
│   │       ├── AgentStatusWidget.tsx
│   │       ├── AgentListWidget.tsx
│   │       ├── CronWidget.tsx
│   │       ├── DockerWidget.tsx
│   │       └── ...
│   ├── lib/
│   │   ├── auth.ts            → JWT sign/verify
│   │   ├── gateway.ts         → Gateway API client (SSRF-guarded)
│   │   ├── instance.ts        → Multi-instance store (localStorage)
│   │   ├── agent-registry.ts  → In-memory connected-agent registry
│   │   ├── agent-ws-handler.ts → Agent WebSocket auth + snapshot handler
│   │   ├── schemas.ts         → Zod schemas for agent messages/snapshots
│   │   └── widgets.ts         → Widget registry
│   └── types/
│       └── index.ts           → Shared types
├── Dockerfile
├── docker-compose.traefik.yml
└── .env.example
```

## Environment Variables

```env
# Required
ADMIN_PASSWORD=<plaintext>       # compared as plaintext, or use ADMIN_PASSWORD_HASH (bcrypt)
ADMIN_PASSWORD_HASH=<bcrypt>     # bcrypt hash, alternative to ADMIN_PASSWORD
JWT_SECRET=<random-32-char>      # JWT signing secret
NEXT_PUBLIC_DEFAULT_GATEWAY_URL= # Default OpenClaw gateway URL (default http://localhost:9500)

# Optional (can be configured per-instance in the UI)
DEFAULT_GATEWAY_TOKEN=           # Default API token
```

`ADMIN_PASSWORD` is compared as plaintext (and a UI password change is persisted
in `CLAWD_MONITOR_DATA_DIR`); set `ADMIN_PASSWORD_HASH` to a precomputed bcrypt
hash instead if you prefer not to store the plaintext in the environment. See
`.env.example` for the full list of supported variables.

## Deployment

Same pattern as depsight — Docker + Traefik on Stone VPS.

Target URL: `clawd-monitor.opentriologue.ai`

Dockerfile: multi-stage (deps → builder → runner), `node:20-slim`.
