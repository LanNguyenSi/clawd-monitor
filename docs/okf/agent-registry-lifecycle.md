---
type: invariant
title: Agent registry lifecycle, from WebSocket handshake to TTL eviction
description: How a clawd-monitor-agent connection becomes an AgentRegistry entry (auth message first, static then persisted token check, newest connection wins), when an entry goes offline (only via its current socket), when it is evicted (lazily, only inside getAll), and what token revocation does and does not affect.
tags: [agents, websocket, registry, tokens, ttl]
timestamp: 2026-11-12T08:46:57Z
sources:
  - server.ts
  - src/lib/ws-upgrade.ts
  - src/lib/agent-ws-handler.ts
  - src/lib/agent-ws-limits.ts
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
  - tests/unit/agent-ws-replaced-socket.test.ts
---

# Agent registry lifecycle, from WebSocket handshake to TTL eviction

The wire protocol (message shapes, the agent CLI) is documented for humans
in [AGENT-PROTOCOL.md](../AGENT-PROTOCOL.md). This doc records the
server-side semantics that span `server.ts`, `src/lib/agent-ws-handler.ts`,
`src/lib/agent-registry.ts` and the routes that read the registry, which no
single one of those files states.

## The invariant

- An agent entry is created or replaced only by a successful `auth` message
  on `/api/agents/ws`; it is written to, and marked offline, only by the
  socket that currently owns it; it is removed only by `AgentRegistry.cleanup()`,
  which runs only inside `getAll()`, and only for an entry that is offline
  and whose last snapshot is older than `AGENT_TTL_MS`, or by
  `DELETE /api/agents/<id>` for an offline entry.

## One registry for two module graphs

The registry is a singleton stored on `globalThis`
(`src/lib/agent-registry.ts:133-138#"export const registry = globalForRegistry.agentRegistry"`).
The custom server (`server.ts`, run by `tsx` or compiled by `tsc`) and the
Next.js-compiled API routes load `agent-registry.ts` as separate module
instances; the `globalThis` slot is what makes the WebSocket handler and the
routes see the same `agents` map. The server graph imports the handler
statically (`server.ts:7#"handleAgentConnection"`), so it creates the
singleton before Next.js starts. Module-level constants of the server-graph
copy, `AGENT_TTL_MS` among them, are the ones the shared instance's methods
use; see [auth and config loading](auth-and-config-loading.md) for when
those constants are read (after the `.env` files were loaded).

## Handshake

1. The real HTTP server has exactly one `upgrade` listener, the router in
   `src/lib/ws-upgrade.ts`, which upgrades the path `/api/agents/ws`
   (`src/lib/ws-upgrade.ts:28#"AGENT_WS_PATH"`). Next is handed a second,
   never-listening server through its `httpServer` option
   (`server.ts:36#"httpServer: nextServer"`), because Next attaches its own
   `upgrade` listener to the server of the first request it serves, and
   that listener ends `/api/agents/ws` (it matches the dynamic route
   `/api/agents/[agentId]`); with it on the real server, agent upgrades
   worked only before the first HTTP request. Any other upgrade request is
   destroyed in production
   (`src/lib/ws-upgrade.ts:35#"socket.destroy()"`); in development it is
   replayed on Next's server so HMR keeps its socket
   (`server.ts:62#"nextServer.emit"`).
2. Before that, a socket is held to limits in `src/lib/agent-ws-limits.ts`
   until it authenticates. At most 32 such sockets exist at once, 4 per client
   key and 16 per IPv6 /48; the next is closed with 1013
   (`src/lib/agent-ws-limits.ts:185#"AGENT_WS_MAX_UNAUTHENTICATED"`). A slot is
   given back once the socket authenticated, closed, errored, timed out or was
   rejected and the work for its messages (a token compare in progress) has
   settled. A deadline of 10 s closes a silent socket with 1008
   (`src/lib/agent-ws-limits.ts:226#"AGENT_WS_AUTH_TIMEOUT_MS"`). A frame over
   8 KiB closes it with 1009 before any parse
   (`src/lib/agent-ws-handler.ts:38#"guard.tooLarge(raw)"`). A handshake that
   needs the token store is charged to the client IP first, 10 per 15 minutes,
   and the socket is closed with 1008 before the store is read when the
   budget is used up; a socket gets one such handshake, and an `auth` message
   sent meanwhile is ignored
   (`src/lib/agent-ws-handler.ts:66#"guard.admitHandshake()"`). These
   refusals send no `auth_error`. The server as a whole refuses any frame over
   1 MiB (`src/lib/agent-ws-limits.ts:73#"maxPayload"`).
3. Every frame within those limits is JSON-parsed and validated against
   `wsMessageSchema`
   (`auth`, `snapshot` or `ping`). A frame that is not JSON is dropped
   without a reply
   (`src/lib/agent-ws-handler.ts:49-50#"return"`); a JSON frame that fails
   the schema gets `{type:'error'}` and the socket stays open
   (`src/lib/agent-ws-handler.ts:45#"Invalid message format"`).
4. Before authentication, any valid non-`auth` message gets `auth_error`
   and the socket is closed
   (`src/lib/agent-ws-handler.ts:54-56#"ws.close()"`).
5. The token is checked against the `AGENT_TOKENS` list first (exact string
   match), then with `bcrypt.compare` against every `tokenHash` in
   `tokens.json`, and stops at the next entry once the socket is gone
   (`src/lib/agent-ws-handler.ts:83-88#"tokenValid = true"`). A miss sends
   `auth_error` and closes the socket with code 1008
   (`src/lib/agent-ws-handler.ts:145#"guard.close(1008"`). A `tokens.json` read
   that throws (the file is corrupt, empty, unreadable or holds an entry that is
   not an object with string `id`, `name`, `tokenHash` and `createdAt` and, when
   present, a string `lastUsedAt` and `agentId`; only a missing file reads as no
   tokens) is handled the same way: `auth_error`, close 1008, and
   a warning that carries only the error message, naming the file, so the
   client learns nothing about the store and the operator sees the cause
   (`src/lib/agent-ws-handler.ts:74-77#"guard.close(1008, 'Invalid token')"`).
6. On success the handler calls `registry.register()` with the agent's
   self-reported `agentId`, `name`, `version`, `gatewayUrl` and
   `gatewayToken`, then sends `auth_ok`
   (`src/lib/agent-ws-handler.ts:149-161#"auth_ok"`). The handshake does not
   validate `gatewayUrl` (the documented agent protocol sends a loopback
   URL); the only consumer that fetches it, the logs route, does so through
   `remoteGatewayFetch`, which applies the full URL rule (https, host and port
   in `ALLOWED_GATEWAY_HOSTS`, no private range) without the default-gateway
   exception and connects only to addresses it checked
   (`src/app/api/agents/[agentId]/logs/route.ts:75#"remoteGatewayFetch(agent.gatewayUrl"`).

After authentication only `snapshot` and `ping` are handled; a second
`auth` message is ignored
(`src/lib/agent-ws-handler.ts:173-182#"type: 'pong'"`). A snapshot is stored
under the connection's own `agentId`, not the `agentId` field inside the
snapshot payload, and only when the connection still owns the entry (see
"Newest connection wins")
(`src/lib/agent-ws-handler.ts:174#"registry.update(ws, agentId, msg.data)"`).

## Persisted tokens are bound to an agent on first use

A `TokenEntry` holds `id`, `name`, `tokenHash`, `createdAt`, an optional
`lastUsedAt` and an optional `agentId`
(`src/lib/data-store.ts:115-116#"agentId?: string"`). A static `AGENT_TOKENS`
match carries no entry, so it is not bound: its holder can register any
`agentId`, including one another agent is using. A match against a persisted
token is bound: the handler re-reads `tokens.json` after the bcrypt
comparison, patches only the matched id and rewrites the file with no await
in between, so a token created or revoked during the comparison is neither lost
nor restored. If the matched id is no longer in the fresh read, or the re-read
itself fails, the handshake is rejected with `auth_error` (fail closed). An
entry without `agentId` records the handshake's `agentId` in that write
(existing tokens bind on their next handshake); an entry with another
`agentId` is rejected with the same `auth_error` and close 1008 as an invalid
token, and the registry is not touched
(`src/lib/agent-ws-handler.ts:113#"current.agentId !== msg.agentId"`).
The same write stamps `lastUsedAt`
(`src/lib/agent-ws-handler.ts:123#"current.lastUsedAt"`). A failed write does
not fail the handshake of an already bound token, but a failed write of a new
binding does (fail closed), because the token would otherwise stay usable for
any `agentId`
(`src/lib/agent-ws-handler.ts:128#"best effort"`,
`src/lib/agent-ws-handler.ts:134#"needsBinding"`). Binding is trust on
first use and not unique: two tokens may bind the same `agentId` (a token is
rotated by creating the new one before revoking the old), and revoking a token
drops its binding with the entry. An entry whose stored `agentId` is the empty
string matches no handshake (the schema requires a non-empty `agentId`), so
such a token is unusable. The settings API passes `id`, `name`, `createdAt`,
`lastUsedAt` and `agentId` through, never the hash
(`src/app/api/settings/tokens/route.ts:24#"stored.map"`).

## Newest connection wins

`register()` overwrites the map entry for the `agentId` with the new socket
and `online: true`, carrying over `lastSnapshot` and `lastSnapshotAt` from
any previous entry
(`src/lib/agent-registry.ts:61-66#"online: true"`). The old socket is left
open on purpose
(`src/lib/agent-registry.ts:70-71#"skips stale sockets"`). When it later
closes, `disconnect(agentId, ws)` sees that it is no longer the entry's
socket and does nothing
(`src/lib/agent-registry.ts:96-100#"entry.online = false"`), so a reconnect
is never marked offline by the stale socket's close. Regression-pinned by
`tests/unit/agent-registry.test.ts:236#"does NOT mark the agent offline when called with a stale (replaced) ws"`.

A replaced socket cannot write either. `update(ws, agentId, snapshot)` takes
the sending socket as a required argument and stores nothing, returning
`false`, unless `ws` is the entry's current socket
(`src/lib/agent-registry.ts:87-89#"entry.ws !== ws"`); the check lives in
the registry, not at the call site, so the one write a socket triggers
cannot skip it. Before this check a replaced socket kept its `agentId` from
the closure and kept overwriting the current connection's snapshot, so a
takeover kept injecting after the real agent reconnected, and a stale
connection of the real agent could overwrite fresh data.

The replaced socket is dropped, not left silently connected. When the
handler's `registry.update()` returns `false`, the handler sends no `ack`,
logs a warning and closes that socket with code 4000
(`src/lib/agent-ws-handler.ts:176#"REPLACED_CLOSE_CODE"`). The close
happens on the replaced socket's own next `snapshot`, never inside
`register()`, which keeps its rule of not touching the old socket (event
loop interference with the new connection). An agent that sees 4000 has been
replaced by a newer connection of the same `agentId`; the reference agent
reconnects with its backoff and becomes the current connection again. Two
live agent processes configured with one `agentId` therefore take turns
replacing each other, about once per snapshot interval plus the 1 s reconnect delay, instead of one silently feeding a
dropped stream. A `ping` on a replaced socket is still answered with `pong`
and does not close it, because it writes nothing. The close of the replaced
socket reaches `disconnect(agentId, ws)` as a stale socket and leaves the
agent online. Pinned by `tests/unit/agent-ws-replaced-socket.test.ts` and the
`update` cases in `tests/unit/agent-registry.test.ts`.

A `snapshot` from the current socket sets `online: true` again
(`src/lib/agent-registry.ts:87-93#"entry.online = true"`). A `ping` only
answers `pong` and touches no registry field, so an agent that pings but
never sends snapshots keeps `lastSnapshotAt` at its last snapshot (or `0`).

## Offline and eviction

An entry goes offline only through `disconnect()` from the socket's `close`
handler (`src/lib/agent-ws-handler.ts:192#"registry.disconnect(agentId, ws)"`).
There is no server-side idle timeout: an entry whose socket stays open is
online indefinitely, whether or not it sends snapshots.

Eviction is lazy. `cleanup()` deletes an entry when it is offline and
`now - lastSnapshotAt > AGENT_TTL_MS`
(`src/lib/agent-registry.ts:126#"now - entry.lastSnapshotAt > AGENT_TTL_MS"`),
with `AGENT_TTL_MS` defaulting to 300000 ms
(`src/lib/agent-registry.ts:22#"AGENT_TTL_MS"`); a value that is not a plain
positive integer falls back to that default with one `console.warn`
(`src/lib/agent-registry.ts:24#"export function parseAgentTtlMs"`). Only `getAll()` calls it
(`src/lib/agent-registry.ts:103-104#"this.cleanup()"`), and only two routes
call `getAll()`: `GET /api/agents/list`
(`src/app/api/agents/list/route.ts:11#"registry.getAll()"`) and the
unauthenticated `GET /api/health`
(`src/app/api/health/route.ts:7#"registry.getAll()"`). Consequences:

- Until one of those two routes is requested, an expired entry stays in the
  map, and `getAgent()` (no cleanup) still returns it
  (`src/lib/agent-registry.ts:108-111#"return toPublicEntry(entry)"`), so
  `GET /api/agents/<id>/snapshot` answers with the stale snapshot and
  `online: false`
  (`src/app/api/agents/[agentId]/snapshot/route.ts:16-23#"online: agent.online"`).
- The logs route reads `registry.agents` directly and answers 503 for an
  offline entry
  (`src/app/api/agents/[agentId]/logs/route.ts:18-21#"Agent offline"`).
- An entry that never received a snapshot has `lastSnapshotAt` `0`, so
  the first `getAll()` after it goes offline evicts it.

`DELETE /api/agents/<id>` removes an entry now, without waiting for the
TTL: the `AgentSwitcher` remove button, shown for offline agents only,
sends it (`src/components/Nav/AgentSwitcher.tsx:78-79#"method: 'DELETE'"`).
The route calls `registry.remove()`
(`src/app/api/agents/[agentId]/route.ts:17#"registry.remove(agentId)"`), which
deletes an offline entry, refuses an online one with 409 and answers 404 for
an unknown id
(`src/lib/agent-registry.ts:115#"remove(agentId: string)"`). The switcher
keeps the entry in its list on any failure other than 404, so a removed agent
does not reappear on the next 5-second poll unless it reconnects.

## Token revocation affects new connections only

`DELETE /api/settings/tokens/<id>` rewrites `tokens.json` without the entry
(`src/app/api/settings/tokens/[id]/route.ts:51-55#"writeTokens(filtered)"`)
and does not touch the registry. A token is checked only during the
handshake, so a connected agent keeps its socket and keeps sending
snapshots after its token is deleted; the deletion takes effect on its next
reconnect. `AGENT_TOKENS` is read once at module load
(`src/lib/agent-ws-handler.ts:10-13#".filter(Boolean)"`), so removing a
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
