# Tasks: Wave 7 — OS Tool Polish

*Authored by Ice 🧊 — Lan's approved roadmap*
*Lead: Ice (spec + review + deploy) | Implementation: Lava*

---

## Wave 7 — v1 Feature Completion

### Task W7-001 — Password Change in UI
**Priority:** critical (security)
**Branch:** `feat/w7-001-password-change`
**Estimated effort:** 20m

**Objective:** User can change admin password from within the dashboard.

**Deliverables:**
- New page `/settings` — accessible from Navbar (gear icon or "Settings" link)
- `src/app/settings/page.tsx` — protected route
- Form: Current password + New password + Confirm password
- `POST /api/auth/change-password` route
  - Verifies current password (bcrypt or plaintext compare depending on config)
  - Updates `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` env — **writes to persistent config file** `/data/clawd-monitor.env` (mounted volume)
  - Returns 200 on success
- Show success/error feedback inline

**Important:** Since env vars in Docker are set at runtime, persist password to `/data/clawd-monitor.env` which is loaded by the server on startup. Add `CLAWD_MONITOR_DATA_DIR=/data` env var, mount volume in docker-compose.

**Acceptance Criteria:**
- [ ] User can change password from UI
- [ ] New password works on next login
- [ ] Old password no longer works
- [ ] Weak passwords rejected (min 8 chars)

---

### Task W7-002 — Agent Token Management
**Priority:** critical (security + onboarding)
**Branch:** `feat/w7-002-agent-tokens`
**Estimated effort:** 45m

**Objective:** User can create, view, and revoke agent tokens from the UI. Tokens persist to disk.

**Deliverables:**

`/settings` page (extends W7-001):

**Token list:**
```
Agent Tokens
──────────────────────────────────────
[🟢] token-ice-local    Ice (local)     Created 2026-03-29  [Copy] [Revoke]
[🟢] token-lava-vps     Lava VPS        Created 2026-03-29  [Copy] [Revoke]
──────────────────────────────────────
[+ Generate New Token]
```

**Generate token flow:**
1. Click "+ Generate New Token"
2. Modal: enter agent name (e.g. "Lava VPS")
3. System generates random token (32 hex chars)
4. Show token once with "Copy to clipboard" button + warning "Store this — won't be shown again"
5. Token saved to `/data/tokens.json`

**API routes:**
- `GET /api/settings/tokens` — list tokens (name, created, lastUsed — NOT the token itself)
- `POST /api/settings/tokens` — create `{ name: string }` → returns `{ token, name, id }`
- `DELETE /api/settings/tokens/[id]` — revoke token

**Token persistence:** `/data/tokens.json`
```json
[
  { "id": "uuid", "name": "Ice (local)", "tokenHash": "bcrypt_hash", "createdAt": "..." }
]
```

Token validation in `agent-ws-handler.ts`: load from `/data/tokens.json` at startup + watch for changes.

**Acceptance Criteria:**
- [ ] Tokens visible in Settings page
- [ ] New token generated and shown once
- [ ] Revoked token rejected by WebSocket handler
- [ ] Tokens persist across restarts

---

### Task W7-003 — Install Link / Onboarding Snippet
**Priority:** high
**Branch:** `feat/w7-003-install-snippet`
**Estimated effort:** 20m

**Objective:** After generating a token, user gets copy-paste install snippet.

**Deliverables:**

After token creation (modal step 2):

```
Your agent is ready to connect.

Install on your host:

  npm install -g clawd-monitor-agent
  clawd-monitor-agent \
    --server https://clawd-monitor.opentriologue.ai \
    --token abc123def456 \
    --name "Lava VPS"

Or with Docker Compose:

  services:
    clawd-monitor-agent:
      image: ghcr.io/lannguyen/clawd-monitor-agent:latest
      environment:
        - SERVER=https://clawd-monitor.opentriologue.ai
        - TOKEN=abc123def456
      restart: unless-stopped
```

Both snippets are copy-able. Server URL is auto-filled from `NEXT_PUBLIC_BASE_URL` env var.

**Acceptance Criteria:**
- [ ] Install snippet shown after token generation
- [ ] Copy buttons work
- [ ] Server URL auto-filled

---

### Task W7-004 — Navbar Agent Switcher (replaces Widget-as-Switcher)
**Priority:** high (UX)
**Branch:** `feat/w7-004-agent-switcher`
**Estimated effort:** 30m

**Objective:** Agent selection moves from Widget to Navbar. Persisted in localStorage.

**Deliverables:**

Replace current Instance Switcher in Navbar with Agent Switcher:

```
[🐾 clawd-monitor]  [2 col][4 col][8 col]  [🟢 Ice (local) ▾]  [+ Widget]  [Settings]
```

Dropdown on click:
```
  All agents
  ──────────
  🟢 Ice (local)     online · 2s ago
  🟢 Lava VPS        online · 1s ago
  🔴 Old Agent       offline · 5h ago  [Remove]
```

- "All agents" = no active agent, widgets use direct proxy (current behavior)
- Clicking an agent = sets activeAgentId, persisted to localStorage
- Active agent badge shown in Navbar
- Remove button deletes offline agents from registry

**Remove the AgentListWidget** from WIDGET_REGISTRY or keep as read-only overview (no click-to-select).

**Acceptance Criteria:**
- [ ] Agent Switcher in Navbar
- [ ] Selection persists after reload (localStorage)
- [ ] "All agents" returns widgets to default proxy mode
- [ ] Offline agents shown with grey dot + last-seen time
- [ ] Remove button works

---

### Task W7-005 — Widgets Reactive to Active Agent
**Priority:** high (core functionality)
**Branch:** `feat/w7-005-widget-agent-data`
**Estimated effort:** 45m

**Objective:** When an agent is selected, all widgets show that agent's snapshot data.

**Pattern per widget:**
```typescript
const { activeAgentId } = useActiveAgent()
const { data: snapshot } = useSWR(
  activeAgentId ? `/api/agents/${activeAgentId}/snapshot` : null,
  fetcher,
  { refreshInterval: 5000 }
)

// If agent selected: use snapshot data
// If no agent: use existing proxy fetch (unchanged)
```

**Widgets to update:**
- `AgentStatusWidget` → `snapshot.sessions`
- `CronWidget` → `snapshot.cronJobs`
- `DockerWidget` → `snapshot.containers`
- `MetricsWidget` → `snapshot.metrics` (cpuPercent, memUsedBytes, memTotalBytes)
- `MemoryWidget` → re-enable, read from `snapshot.memoryFiles` — **no filesystem access**
- `HeartbeatWidget` → `snapshot.metrics.uptimeSeconds` + online status

**Type mapping** (agent snapshot → widget format):
```typescript
// MetricsWidget expects: { cpu: number, memUsed: number, memTotal: number }
// Snapshot has: { cpuPercent: number, memUsedBytes: number, memTotalBytes: number }
// → map in widget
```

**Acceptance Criteria:**
- [ ] Clicking "Ice (local)" → widgets show Ice's data
- [ ] Clicking "Lava VPS" → widgets show Lava's data
- [ ] "All agents" → widgets use direct proxy (unchanged)
- [ ] Widgets show "Agent offline — last seen X ago" when agent disconnected
- [ ] No 404 loops, no fetch errors in console

---

### Task W7-006 — Agent Name Editable + Remove
**Priority:** medium (polish)
**Branch:** `feat/w7-006-agent-management`
**Estimated effort:** 20m

**Objective:** User can edit agent display name and remove stale agents.

**Deliverables:**
- In Settings → Agent Tokens: editable name field (inline edit)
- `PATCH /api/settings/tokens/[id]` — update name
- In Navbar Agent Switcher: "Remove" button for offline agents
- `DELETE /api/agents/[id]` — remove from in-memory registry + localStorage

**Acceptance Criteria:**
- [ ] Agent name editable in Settings
- [ ] Name change reflected in Navbar switcher
- [ ] Remove button removes offline agent from list

---

## Rules for Lava

- One branch per task, exact naming: `feat/w7-<NNN>-<name>`
- PR title: `feat(w7-NNN): description`
- Build must pass (`npm run build` zero errors) before opening PR
- No force-push to master
- No direct commits to master
- Ice reviews every PR before merge

## Deploy Order

Deploy after each merged PR — incremental, not batched.

---

*Ice 🧊 — 2026-03-29*
