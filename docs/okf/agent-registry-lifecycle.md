---
type: invariant
title: Agent registry lifecycle, from WebSocket handshake to TTL eviction
description: How a clawd-monitor-agent connection becomes an AgentRegistry entry (auth message first, static then persisted token check, newest connection wins), when an entry goes offline (only via its current socket), when it is evicted (lazily, only inside getAll), and what token revocation does and does not affect.
tags: [agents, websocket, registry, tokens, ttl]
timestamp: 2026-10-15T11:55:56Z
sources:
  - server.ts
  - src/lib/agent-ws-handler.ts
  - src/lib/agent-registry.ts
  - src/lib/schemas.ts
  - src/lib/data-store.ts
  - src/app/api/agents/list/route.ts
  - src/app/api/agents/[agentId]/snapshot/route.ts
  - src/app/api/agents/[agentId]/logs/route.ts
  - src/app/api/agents/[agentId]/route.ts
  - src/app/api/health/route.ts
  - src/app/api/settings/tokens/route.ts
  - src/app/api/settings/tokens/[id]/route.ts
  - src/components/Nav/AgentSwitcher.tsx
  - tests/unit/agent-registry.test.ts
---

# Agent registry lifecycle, from WebSocket handshake to TTL eviction

The wire protocol (message shapes, the agent CLI) is documented for humans
in [AGENT-PROTOCOL.md](../AGENT-PROTOCOL.md). This doc records the
server-side semantics that span `server.ts`, `src/lib/agent-ws-handler.ts`,
`src/lib/agent-registry.ts` and the routes that read the registry, which no
single one of those files states.

## The invariant

- An agent entry is created or replaced only by a successful `auth` message
  on `/api/agents/ws`; it is marked offline only by the close of the socket
  that currently owns it; it is removed only by `AgentRegistry.cleanup()`,
  which runs only inside `getAll()`, and only for an entry that is offline
  and whose last snapshot is older than `AGENT_TTL_MS`, or by
  `DELETE /api/agents/<id>` for an offline entry.

## One registry for two module graphs

The registry is a singleton stored on `globalThis`
(`src/lib/agent-registry.ts:106-111#"export const registry = globalForRegistry.agentRegistry"`).
The custom server (`server.ts`, run by `tsx` or compiled by `tsc`) and the
Next.js-compiled API routes load `agent-registry.ts` as separate module
instances; the `globalThis` slot is what makes the WebSocket handler and the
routes see the same `agents` map. The server graph imports the handler
statically (`server.ts:8#"handleAgentConnection"`), so it creates the
singleton before Next.js starts. Module-level constants of the server-graph
copy, `AGENT_TTL_MS` among them, are the ones the shared instance's methods
use; see [auth and config loading](auth-and-config-loading.md) for when
those constants are read (after the `.env` files were loaded).

## Handshake

1. `server.ts` upgrades only the path `/api/agents/ws` and destroys every
   other upgrade request
   (`server.ts:42-48#"socket.destroy()"`).
2. Every frame is JSON-parsed and validated against `wsMessageSchema`
   (`auth`, `snapshot` or `ping`). A frame that is not JSON is dropped
   without a reply
   (`src/lib/agent-ws-handler.ts:36-37#"return"`); a JSON frame that fails
   the schema gets `{type:'error'}` and the socket stays open
   (`src/lib/agent-ws-handler.ts:30-32#"Invalid message format"`).
3. Before authentication, any valid non-`auth` message gets `auth_error`
   and the socket is closed
   (`src/lib/agent-ws-handler.ts:41-43#"ws.close()"`).
4. The token is checked against the `AGENT_TOKENS` list first (exact string
   match), then with `bcrypt.compare` against every `tokenHash` in
   `tokens.json`
   (`src/lib/agent-ws-handler.ts:51-54#"tokenValid = true"`). A miss sends
   `auth_error` and closes the socket
   (`src/lib/agent-ws-handler.ts:89-92#"ws.close()"`).
5. On success the handler calls `registry.register()` with the agent's
   self-reported `agentId`, `name`, `version`, `gatewayUrl` and
   `gatewayToken`, then sends `auth_ok`
   (`src/lib/agent-ws-handler.ts:96-107#"auth_ok"`).

After authentication only `snapshot` and `ping` are handled; a second
`auth` message is ignored
(`src/lib/agent-ws-handler.ts:115-117#"type: 'pong'"`). A snapshot is stored
under the connection's own `agentId`, not the `agentId` field inside the
snapshot payload
(`src/lib/agent-ws-handler.ts:113#"registry.update(agentId, msg.data)"`).

## Tokens are not bound to an agent

Neither token source carries an `agentId`: a `TokenEntry` holds `id`,
`name`, `tokenHash`, `createdAt` and an optional `lastUsedAt`
(`src/lib/data-store.ts:29-34#"lastUsedAt?: string"`), and the handshake
only asks whether the token is valid. Any valid token can therefore register
any `agentId`, including one another agent is using. A match against a
persisted token stamps that entry's `lastUsedAt`: the handler re-reads
`tokens.json` after the bcrypt comparison, patches only the matched id and
rewrites the file with no await in between, so a token created or revoked
during the comparison is neither lost nor restored. If the matched id is
no longer in the fresh read, or the re-read itself fails, the handshake is
rejected with `auth_error` (fail closed). A failed write does not fail the
handshake
(`src/lib/agent-ws-handler.ts:79-80#"current.lastUsedAt"`,
`src/lib/agent-ws-handler.ts:84#"best effort"`). A static
`AGENT_TOKENS` match has no entry and stamps nothing. The settings API passes
the stored value through
(`src/app/api/settings/tokens/route.ts:14#"id, name, createdAt, lastUsedAt"`).

## Newest connection wins

`register()` overwrites the map entry for the `agentId` with the new socket
and `online: true`, carrying over `lastSnapshot` and `lastSnapshotAt` from
any previous entry
(`src/lib/agent-registry.ts:46-51#"online: true"`). The old socket is left
open on purpose
(`src/lib/agent-registry.ts:55-56#"skips stale sockets"`). When it later
closes, `disconnect(agentId, ws)` sees that it is no longer the entry's
socket and does nothing
(`src/lib/agent-registry.ts:69-73#"entry.online = false"`), so a reconnect
is never marked offline by the stale socket's close. Regression-pinned by
`tests/unit/agent-registry.test.ts:174#"does NOT mark the agent offline when called with a stale (replaced) ws"`.

A `snapshot` sets `online: true` again
(`src/lib/agent-registry.ts:61-66#"entry.online = true"`). A `ping` only
answers `pong` and touches no registry field, so an agent that pings but
never sends snapshots keeps `lastSnapshotAt` at its last snapshot (or `0`).

## Offline and eviction

An entry goes offline only through `disconnect()` from the socket's `close`
handler (`src/lib/agent-ws-handler.ts:122#"registry.disconnect(agentId, ws)"`).
There is no server-side idle timeout: an entry whose socket stays open is
online indefinitely, whether or not it sends snapshots.

Eviction is lazy. `cleanup()` deletes an entry when it is offline and
`now - lastSnapshotAt > AGENT_TTL_MS`
(`src/lib/agent-registry.ts:99#"now - entry.lastSnapshotAt > AGENT_TTL_MS"`),
with `AGENT_TTL_MS` defaulting to 300000 ms
(`src/lib/agent-registry.ts:22#"AGENT_TTL_MS"`). Only `getAll()` calls it
(`src/lib/agent-registry.ts:76-77#"this.cleanup()"`), and only two routes
call `getAll()`: `GET /api/agents/list`
(`src/app/api/agents/list/route.ts:11#"registry.getAll()"`) and the
unauthenticated `GET /api/health`
(`src/app/api/health/route.ts:7#"registry.getAll()"`). Consequences:

- Until one of those two routes is requested, an expired entry stays in the
  map, and `getAgent()` (no cleanup) still returns it
  (`src/lib/agent-registry.ts:81-84#"return toPublicEntry(entry)"`), so
  `GET /api/agents/<id>/snapshot` answers with the stale snapshot and
  `online: false`
  (`src/app/api/agents/[agentId]/snapshot/route.ts:16-23#"online: agent.online"`).
- The logs route reads `registry.agents` directly and answers 503 for an
  offline entry
  (`src/app/api/agents/[agentId]/logs/route.ts:16-19#"Agent offline"`).
- An entry that never received a snapshot has `lastSnapshotAt` `0`, so
  the first `getAll()` after it goes offline evicts it.

`DELETE /api/agents/<id>` removes an entry now, without waiting for the
TTL: the `AgentSwitcher` remove button, shown for offline agents only,
sends it (`src/components/Nav/AgentSwitcher.tsx:63-64#"method: 'DELETE'"`).
The route calls `registry.remove()`
(`src/app/api/agents/[agentId]/route.ts:17#"registry.remove(agentId)"`), which
deletes an offline entry, refuses an online one with 409 and answers 404 for
an unknown id
(`src/lib/agent-registry.ts:88#"remove(agentId: string)"`). The switcher
keeps the entry in its list on any failure other than 404, so a removed agent
does not reappear on the next 5-second poll unless it reconnects.

## Token revocation affects new connections only

`DELETE /api/settings/tokens/<id>` rewrites `tokens.json` without the entry
(`src/app/api/settings/tokens/[id]/route.ts:36-40#"writeTokens(filtered)"`)
and does not touch the registry. A token is checked only during the
handshake, so a connected agent keeps its socket and keeps sending
snapshots after its token is deleted; the deletion takes effect on its next
reconnect. `AGENT_TOKENS` is read once at module load
(`src/lib/agent-ws-handler.ts:9-12#".filter(Boolean)"`), so removing a
static token takes a restart.

## What the registry exposes

`toPublicEntry()` strips `ws`, `token` and `gatewayToken`
(`src/lib/agent-registry.ts:20#"Omit<AgentEntry, 'ws' | 'token' | 'gatewayToken'>"`);
every route response built from `getAll()` or `getAgent()` uses that shape.

## What breaks it

- Dropping the `entry.ws !== ws` check in `disconnect()` would mark a
  freshly reconnected agent offline as soon as its replaced socket closes.
- Calling `cleanup()` from `getAgent()` would make the snapshot route return
  404 for an expired agent instead of its last snapshot.
- Importing `agent-registry.ts` into the route graph without the
  `globalThis` slot would give the routes an empty registry.
