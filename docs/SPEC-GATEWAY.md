# Spec: clawd-monitor Gateway Changes (Wave 6)

*Authored by Ice 🧊 — Changes needed in clawd-monitor to support push-based agents*

---

## Overview

clawd-monitor needs three additions to support the agent push model:

1. **WebSocket endpoint** — accepts agent connections, handles auth + snapshot pushes
2. **Agent Registry** — in-memory store of connected agents + their latest snapshots
3. **Updated widgets** — render data from agent registry instead of direct proxy calls

---

## New Files

### `src/app/api/agents/ws/route.ts`

WebSocket handler for agent connections.

```typescript
// GET /api/agents/ws — WebSocket upgrade endpoint
// No user JWT required — uses agent token
```

**Behavior:**
- Upgrades HTTP to WebSocket
- Expects first message: `{ type: "auth", token, agentId, name, version }`
- Validates agent token against `AGENT_TOKENS` env var (comma-separated list)
- On success: sends `{ type: "auth_ok" }`, registers agent in registry
- On failure: sends `{ type: "auth_error" }`, closes connection
- On `snapshot` message: updates agent registry with latest data
- On `ping`: responds with `{ type: "pong" }`
- On disconnect: marks agent as offline in registry (keep last snapshot for 5min TTL)

**Token validation:**
```
AGENT_TOKENS=token1,token2,token3
```
Each token can register one agent. Token uniquely identifies the agent.

---

### `src/lib/agent-registry.ts`

In-memory registry (no DB needed).

```typescript
interface AgentEntry {
  agentId: string
  name: string
  version: string
  token: string           // which token authenticated this agent
  connectedAt: number
  lastSnapshotAt: number
  lastSnapshot: AgentSnapshot | null
  online: boolean
  ws: WebSocket           // live connection reference
}

// Singleton registry
class AgentRegistry {
  agents: Map<string, AgentEntry>

  register(ws, meta): void
  update(agentId, snapshot): void
  disconnect(agentId): void
  getAll(): AgentEntry[]
  getAgent(agentId): AgentEntry | null
  cleanup(): void         // remove entries older than TTL
}

export const registry = new AgentRegistry()
```

---

### `src/app/api/agents/list/route.ts`

```typescript
// GET /api/agents/list — requires user JWT
// Returns: { agents: AgentEntry[] (without ws reference) }
```

---

### `src/app/api/agents/[agentId]/snapshot/route.ts`

```typescript
// GET /api/agents/:agentId/snapshot — requires user JWT
// Returns: { snapshot: AgentSnapshot | null, lastSnapshotAt, online }
```

---

## Environment Variables

```env
# Agent tokens (comma-separated, one per agent)
AGENT_TOKENS=token-ice-local,token-lava-vps

# Token TTL for offline agents (ms, default: 300000 = 5min)
AGENT_TTL_MS=300000
```

---

## Updated Widgets

### New Widget: `AgentListWidget`

Shows all connected agents with status dot (online/offline), last seen, name, version.

```
┌─────────────────────────────────┐
│ 🟢 Ice (local)     online 2s   │
│    Sessions: 3 · Crons: 5       │
├─────────────────────────────────┤
│ 🟢 Lava VPS        online 8s   │
│    Sessions: 1 · Crons: 2       │
└─────────────────────────────────┘
```

Clicking an agent switches the "active agent" context for all other widgets.

### Updated Widgets (when agent context is set)

All existing widgets (Sessions, Cron, Metrics, Memory, Docker) should check:
1. Is an agent selected? → fetch from `/api/agents/:id/snapshot` and read from snapshot
2. Otherwise: use existing direct proxy (backward compatible)

This is additive — existing direct-proxy behavior unchanged when no agent is selected.

---

## Widget Registry Update

Add to `src/lib/widgets.ts`:
```typescript
{ id: 'agent-list', title: 'Connected Agents', component: 'AgentListWidget', defaultW: 2, defaultH: 2, minW: 1, minH: 1 }
```

---

## Acceptance Criteria

- [ ] WebSocket endpoint accepts agent connections at `/api/agents/ws`
- [ ] Auth handshake works (token validation, auth_ok/auth_error)
- [ ] Snapshot messages update agent registry
- [ ] `GET /api/agents/list` returns all agents (online + offline with last snapshot)
- [ ] `GET /api/agents/:id/snapshot` returns latest snapshot
- [ ] AgentListWidget shows connected agents with status
- [ ] Clicking agent in AgentListWidget sets active agent context
- [ ] Metrics/Sessions/Cron/Memory/Docker widgets render from agent snapshot when agent selected
- [ ] Zero TypeScript errors, build passes
- [ ] Backward compatible — direct proxy still works when no agent selected

---

## Implementation Notes

### WebSocket in Next.js App Router

Next.js App Router does not natively support WebSocket upgrades in route handlers. Use one of:
1. **Custom server** (`server.ts`) — wrap Next.js in a Node.js HTTP server, add WebSocket upgrade handler
2. **Separate WebSocket path** — run a small ws server on a different port (e.g. 3001), proxy via Traefik

**Recommended:** Custom server approach — keeps everything in one process.

Add `src/server.ts`:
```typescript
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handleAgentConnection } from './lib/agent-ws-handler'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', handleAgentConnection)

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/agents/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(3000)
})
```

Update `package.json`:
```json
"scripts": {
  "dev": "ts-node src/server.ts",
  "start": "node dist/server.js"
}
```

### Dockerfile update

The standalone output doesn't support custom server — switch to regular build:
```dockerfile
# Remove: output: 'standalone' from next.config.mjs
# Build: npm run build → .next/
# Start: node src/server.ts (compiled)
```

---

*This spec is for Lava to implement. Ice will review the PR.*
