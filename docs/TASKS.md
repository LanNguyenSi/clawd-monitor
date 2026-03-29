# Tasks: clawd-monitor

## Wave 1 — Scaffold, Auth, Grid Shell

### Task 001 — Project Scaffold
**Priority:** critical
**Assigned:** Lava
**Status:** open
**Estimated effort:** 30m

**Objective:** Bootstrap Next.js 15 project with all dependencies, config files, and deployment setup.

**Deliverables:**
- `npx create-next-app` with TypeScript, Tailwind, App Router
- Install: `react-grid-layout`, `swr`, `jsonwebtoken`, `bcryptjs`, `@types/*`
- `tsconfig.json` — strict mode, `@/*` → `./src/*` path alias
- `Dockerfile` (multi-stage, node:20-slim)
- `docker-compose.traefik.yml` with `clawd-monitor.opentriologue.ai` Traefik labels
- `.env.example` with all required variables documented
- `lib/auth.ts` — `generateToken(payload)`, `verifyToken(token)`, `extractToken(req)`
- `lib/gateway.ts` — `gatewayFetch(path, options)` using active instance config
- `lib/instance.ts` — `getInstances()`, `getActiveInstance()`, `setActiveInstance()`, `saveInstance()` (localStorage)
- `types/index.ts` — shared types: `Widget`, `WidgetSize`, `Instance`, `GridLayout`

**Acceptance Criteria:**
- [ ] `npm run build` exits 0, zero TS errors
- [ ] `POST /api/auth` with correct password returns JWT
- [ ] `POST /api/auth` with wrong password returns 401
- [ ] `lib/gateway.ts` gatewayFetch uses Authorization header from active instance
- [ ] Dockerfile builds successfully

---

### Task 002 — Widget Grid Shell
**Priority:** critical
**Assigned:** Lava
**Status:** open
**Estimated effort:** 45m

**Objective:** Dashboard page with drag-and-drop grid, layout persistence, and empty widget placeholders.

**Deliverables:**
- `/app/dashboard/page.tsx` — protected route (redirect to /login if no JWT)
- `components/Grid/WidgetGrid.tsx` — react-grid-layout wrapper
  - Layout modes: 2-col, 4-col, 8-col (selectable in nav)
  - rowHeight: 150px
  - Save layout to localStorage on drag/resize
  - Load layout from localStorage on mount
- `components/Grid/GridItem.tsx` — widget wrapper with title bar, loading state, error state
- `components/Nav/Navbar.tsx` — top nav with: logo, layout selector (2/4/8), instance switcher placeholder, logout
- `lib/widgets.ts` — widget registry: `{ id, title, component, defaultW, defaultH }`
- `app/(auth)/login/page.tsx` — login form, calls `/api/auth`, stores JWT in localStorage
- `app/api/auth/route.ts` — POST, bcrypt compare, returns JWT
- `app/api/proxy/[...path]/route.ts` — proxy to Gateway, adds Authorization header, returns response

**Acceptance Criteria:**
- [ ] Dashboard shows empty grid with placeholder widgets
- [ ] Dragging/resizing a widget persists after page refresh
- [ ] Layout toggle between 2/4/8 cols works
- [ ] Login with wrong password shows error message
- [ ] Login with correct password redirects to /dashboard
- [ ] Proxy route forwards requests to Gateway URL with token

---

## Wave 2 — Core Widgets

### Task 003 — Log Tail Widget
**Priority:** high
**Assigned:** Lava
**Status:** open
**Estimated effort:** 45m

**Objective:** Real-time log tailing via SSE.

**Deliverables:**
- `app/api/stream/logs/route.ts` — SSE endpoint
  - Query params: `source=openclaw|docker|system`, `container=<name>` (for docker)
  - For `openclaw`: tail openclaw logs via Gateway `/logs` endpoint (or shell fallback)
  - For `docker`: exec `docker logs --tail 50 --follow <container>` via Node child_process
  - For `system`: tail `/var/log/syslog` or `journalctl -f`
  - Pushes `data: <line>\n\n` format
- `components/widgets/LogTailWidget.tsx` — Client component
  - Source selector dropdown (openclaw/docker/system)
  - Container name input (when docker selected)
  - Auto-scroll to bottom (toggle)
  - Max 500 lines in DOM (rolling window)
  - Monospace font, color-coded: ERROR=red, WARN=yellow, INFO=gray

**Acceptance Criteria:**
- [ ] Logs appear within 500ms of being written
- [ ] Auto-scroll works and can be toggled off
- [ ] Source switching reconnects SSE
- [ ] Widget shows "Connecting…" until first line received
- [ ] Widget shows "Disconnected — retrying" on SSE error, auto-reconnects

---

### Task 004 — CPU + RAM Widget
**Priority:** high
**Assigned:** Lava
**Status:** open
**Estimated effort:** 30m

**Objective:** Live system metrics with sparkline visualization.

**Deliverables:**
- `app/api/proxy/metrics/route.ts` — calls Gateway `/metrics` or falls back to `/proc/meminfo` + `/proc/stat` parsing
- `components/widgets/MetricsWidget.tsx` — Client component
  - CPU %: large number + 60-point sparkline (last 60s)
  - RAM: used/total GB + bar
  - Refresh: every 2s via SWR
  - Color: green < 60%, yellow < 80%, red ≥ 80%

**Acceptance Criteria:**
- [ ] Sparkline shows last 60 datapoints
- [ ] Colors update correctly at thresholds
- [ ] Values update every 2 seconds without full re-render

---

### Task 005 — Memory Viewer Widget
**Priority:** high
**Assigned:** Lava
**Status:** open
**Estimated effort:** 30m

**Objective:** Live view of MEMORY.md and daily memory files.

**Deliverables:**
- `app/api/proxy/memory/route.ts` — reads MEMORY.md via Gateway or direct file access
- `components/widgets/MemoryWidget.tsx`
  - File selector: MEMORY.md / today's daily / yesterday's daily
  - Rendered markdown (react-markdown)
  - Last-updated timestamp
  - Refresh button

**Acceptance Criteria:**
- [ ] MEMORY.md renders as formatted markdown
- [ ] File selector switches between files
- [ ] Last-updated timestamp is accurate

---

### Task 006 — Agent Status Widget
**Priority:** high
**Assigned:** Lava
**Status:** open
**Estimated effort:** 30m

**Objective:** Show active OpenClaw sessions, their model, and last activity.

**Deliverables:**
- `app/api/proxy/sessions/route.ts` — calls Gateway `/sessions` endpoint
- `components/widgets/AgentStatusWidget.tsx`
  - Table: session name | model | last message (truncated) | age
  - Refresh every 10s
  - "No active sessions" empty state

**Acceptance Criteria:**
- [ ] Shows all active sessions from Gateway
- [ ] Age formatted as "2m ago", "1h ago"
- [ ] Auto-refreshes every 10s

---

## Wave 3 — Extended Widgets

### Task 007 — Cron Overview Widget
**Assigned:** Lava | **Effort:** 30m

GET `/api/proxy/cron/jobs` → list with name, schedule, last run, next run, status.
Manual trigger button (POST to Gateway).

### Task 008 — Docker Containers Widget
**Assigned:** Lava | **Effort:** 30m

`docker ps -a` via shell or Gateway. Show: name, status, uptime, restart count. Color by status.

### Task 009 — Heartbeat Pulse Widget
**Assigned:** Lava | **Effort:** 20m

Poll Gateway for last heartbeat. Show: timestamp, response preview, status badge (OK/WARNING/SILENT, SILENT if >35min ago).

### Task 010 — depsight Health Widget
**Assigned:** Lava | **Effort:** 30m

Call depsight API `/api/overview` (needs auth token in widget config). Show top-5 repos by risk score as mini cards.

---

## Wave 4 — Advanced Widgets

### Task 011 — GitHub PR Status Widget
**Assigned:** Lava | **Effort:** 30m

GitHub API → open PRs across configured repos. Show: title, repo, CI status, age. Configurable: org/user + token in widget settings.

### Task 012 — Service Health Widget
**Assigned:** Lava | **Effort:** 20m

Ping configured URLs every 60s. Show: name, status (UP/DOWN), response time. Default: depsight, ci-insights, project-forge.

### Task 013 — Alert History Widget
**Assigned:** Lava | **Effort:** 20m

Read `smart-alert-history.json` from Gateway workspace. Show last 7 days of alerts.

---

## Wave 5 — Polish

### Task 014 — Multi-Instance Switcher
**Assigned:** Lava | **Effort:** 30m

Navbar dropdown to add/edit/switch OpenClaw instances (URL + token). Stored in localStorage. All proxy routes use active instance.

### Task 015 — Keyboard Shortcuts
**Assigned:** Lava | **Effort:** 20m

`1-8`: focus widget by position. `r`: refresh active widget. `s`: screenshot (html2canvas). `e`: toggle edit/lock layout mode. `?`: show shortcut help overlay.

### Task 016 — Screenshot + Export
**Assigned:** Lava | **Effort:** 20m

`s` key → html2canvas → download PNG. Filename: `clawd-monitor-<timestamp>.png`.

### Task 017 — Dark/Light Mode
**Assigned:** Lava | **Effort:** 15m

System preference detection + manual toggle. Persist to localStorage.

---

## Agent Rules

- Branch per task: `feat/task-<NNN>-<name>`
- PR title: `feat(task-NNN): description`
- Build must pass before PR
- No PR merges without Ice review
- Deployment: Ice deploys after review
