---
type: module
title: Auth and config loading across the two module graphs
description: Admin password precedence, the login rate limit and its client key (TRUSTED_PROXY_HOPS), the password.json and tokens.json data files, JWT cookie flags and lifetime, the production startup check, and how the custom server loads .env files before its modules read the environment, while the compiled route graph reads its own variables later.
tags: [auth, config, env, jwt, startup, rate-limit]
timestamp: 2026-11-12T08:46:57Z
sources:
  - server.ts
  - tsconfig.server.json
  - package.json
  - Dockerfile
  - docker-compose.yml
  - docker-compose.traefik.yml
  - src/lib/auth.ts
  - src/lib/client-ip.ts
  - src/lib/login-rate-limit.ts
  - src/lib/secure-compare.ts
  - src/lib/data-store.ts
  - src/lib/env-bootstrap.ts
  - src/lib/agent-ws-handler.ts
  - src/lib/agent-registry.ts
  - src/lib/gateway.ts
  - src/app/api/auth/route.ts
  - src/app/api/auth/change-password/route.ts
  - src/app/api/settings/tokens/route.ts
  - src/app/api/health/route.ts
  - src/app/api/proxy/memory/route.ts
  - src/app/api/proxy/alert-history/route.ts
  - src/app/api/proxy/github/route.ts
  - src/app/dashboard/page.tsx
---

# Auth and config loading across the two module graphs

The variable reference for operators lives in
[configuration.md](../configuration.md) and the process layout in
[ARCHITECTURE.md](../ARCHITECTURE.md). This doc records when each value is
read, which file wins when several are set, and the parts of dashboard
authentication that sit in more than one file.

## Responsibility

- `src/lib/auth.ts` signs and verifies the admin JWT; `src/lib/data-store.ts`
  owns the JSON files under `CLAWD_MONITOR_DATA_DIR`; `server.ts` validates
  startup config. None of them authenticates agents: agent tokens are
  checked in the WebSocket handshake, see
  [agent registry lifecycle](agent-registry-lifecycle.md).

## Two module graphs and env loading

`npm run dev` runs `tsx server.ts`; the production build compiles
`server.ts` with `tsc` and starts `node dist/server.js`
(`package.json:7-9#"node dist/server.js"`). `tsconfig.server.json` compiles
`server.ts` together with the registry and the WebSocket handler
(`tsconfig.server.json:13#"src/lib/agent-ws-handler.ts"`); everything under
`src/app/` is compiled by Next.js into a separate module graph.

The server graph reads its environment at module load, before Next.js
exists. `server.ts` imports `./src/lib/env-bootstrap.js` first
(`server.ts:3#"env-bootstrap"`), which calls `loadEnvConfig()` from
`@next/env` (`src/lib/env-bootstrap.ts:10#"loadEnvConfig(dir, dev)"`) and so puts
`.env`, `.env.local` and the mode-specific variants into `process.env`
before any module below it is evaluated. `@next/env` never replaces a
variable that is already in the process environment, so values from the
shell or from Docker Compose win over the files. The files are expanded
with `dotenv-expand`, which also rewrites a `$` in a value that came from the
process environment when the same key appears in a file (the key is
expanded, not overridden). After that import:

- `server.ts` reads `NODE_ENV`, `PORT` and `HOSTNAME`
  (`server.ts:12-14#"process.env.HOSTNAME"`) and runs the startup check on
  `JWT_SECRET`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH` and, in development
  only, `AGENT_TOKENS` (`server.ts:17-28#"AGENT_TOKENS not set"`) before it
  calls
  `next({ dev, hostname, port, httpServer: nextServer })` (`server.ts:36#"next({ dev, hostname, port"`).
- Its static import of the WebSocket handler (`server.ts:7#"handleAgentConnection"`)
  evaluates three more module-level reads: `AGENT_TOKENS`
  (`src/lib/agent-ws-handler.ts:10-13#".filter(Boolean)"`), `AGENT_TTL_MS`
  (`src/lib/agent-registry.ts:37#"AGENT_TTL_MS"`) and
  `CLAWD_MONITOR_DATA_DIR` (`src/lib/data-store.ts:5#"CLAWD_MONITOR_DATA_DIR"`).

Because the bootstrap import is first, a variable set only in a `.env` or
`.env.local` file reaches both graphs: the startup check, the handshake's
`STATIC_TOKENS`, the registry's `AGENT_TTL_MS`, and the data directory the
handshake and the token routes share. Next.js later calls the same loader
for its own graph; it finds the files already loaded.

The route-graph-only variables (`DEFAULT_GATEWAY_TOKEN` in
`src/lib/gateway.ts:40#"DEFAULT_GATEWAY_TOKEN"`, `ALLOWED_GATEWAY_HOSTS` in
`src/lib/gateway.ts:78#"process.env.ALLOWED_GATEWAY_HOSTS"`, `CLAWD_DIR` in
`src/app/api/proxy/memory/route.ts:9#"CLAWD_DIR"` and
`src/app/api/proxy/alert-history/route.ts:8#"CLAWD_DIR"`, `GITHUB_TOKEN` in
`src/app/api/proxy/github/route.ts:84#"process.env.GITHUB_TOKEN"`) are read
by the routes at request time. The default gateway URL
(`src/lib/gateway.ts:25#"resolveDefaultGatewayUrl"`) is resolved once when
`gateway.ts` loads in the running server (the stream/logs route uses the same
exported value), never frozen at build time:
`DEFAULT_GATEWAY_URL` first, then the deprecated
`NEXT_PUBLIC_DEFAULT_GATEWAY_URL`, then `http://localhost:9500`, an empty value
counting as unset. The deprecated name is looked up through a variable key
because Next.js inlines a literal `process.env.NEXT_PUBLIC_*` with its
build-time value when the variable is set while `next build` runs.

Under Docker the environment is already complete at process start: the runtime stage copies only `.next`,
`public`, `node_modules`, `package.json` and `dist`
(`Dockerfile:50-55#"COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist"`),
and both compose files pass the environment through `environment:` and
`env_file:` so it is in `process.env` when the process starts
(`docker-compose.yml:16-31#"path: .env.runtime"`,
`docker-compose.traefik.yml:6-27#"path: .env.runtime"`). Both set
`CLAWD_MONITOR_DATA_DIR=/data` explicitly
(`docker-compose.yml:18#"CLAWD_MONITOR_DATA_DIR=/data"`).

## Data files

The image ships `/data` owned by the app user, created before `USER`
(`Dockerfile:47#"RUN mkdir -p /data && chown nextjs:nodejs /data"`), so a named
volume that is still empty when it is mounted there takes over that owner and is
writable by UID 1001; a volume that already holds files keeps its owner, and a
bind mount is never adjusted. `data-store.ts` creates the data directory on first use
(`src/lib/data-store.ts:7-11#"return DATA_DIR"`). A write goes to a temp file
in the same directory (mode `0o600`), is fsynced and renamed over the target
(`src/lib/data-store.ts:81#"openSync(tmp, 'wx', 0o600)"`), so a kill in the
middle of a write leaves the old complete file (plus at worst a stray
`.<name>.<random>.tmp`, named with random bytes because node is pid 1 on every
container start and a pid and counter name would collide with a crash
leftover; a name that already exists is skipped, never written to or deleted),
never a truncated one; the file is always `0o600`
afterwards, also when the replaced one had looser permissions, and the data
directory (not only the file) must be writable. The caller's default is
returned only when the file is missing
(`src/lib/data-store.ts:44#"return defaultValue"`). A file that exists but is
empty, not valid JSON, of the wrong shape (`tokens.json` not an array of objects with string `id`,
`name`, `tokenHash` and `createdAt`; `password.json` not an object, or a `hash`
that is empty or not a string) or unreadable (EACCES, EISDIR) throws a
`DataFileError` and is left untouched
(`src/lib/data-store.ts:45#"throw new DataFileError"`). Every caller that
rewrites a file reads it first, so nothing is written over a damaged store:
the settings token routes and the password routes answer 500 and log the
error (`Token store unavailable`, `Password store unavailable`), and the login
route does not fall back to the env password while `password.json` is
unusable. The agent handshake treats a throwing read like an invalid token
and logs the reason (see agent-registry-lifecycle). The operator repairs or
removes the file; removing `password.json` restores the env password, removing
`tokens.json` drops every UI-created token.

- `password.json` holds `{hash}` once the password was changed in the UI
  (`src/lib/data-store.ts:148#"'password.json'"`).
- `tokens.json` holds the agent tokens created in the settings UI, each as
  a bcrypt hash with cost 10
  (`src/app/api/settings/tokens/route.ts:46#"bcrypt.hash(rawToken, 10)"`);
  the raw token is returned once, in the `POST` response. A successful
  handshake with such a token stamps its `lastUsedAt`
  (`src/lib/agent-ws-handler.ts:123#"current.lastUsedAt"`), which the `GET`
  list returns and the settings page shows, and binds the token to the
  handshake's `agentId` when it has none yet
  (`src/lib/agent-ws-handler.ts:124#"current.agentId = msg.agentId"`).

## Admin password precedence

`POST /api/auth` checks, in order: the `password.json` hash, then
`ADMIN_PASSWORD_HASH` (bcrypt), then `ADMIN_PASSWORD` (compared with
`safeEqual`, a constant-time comparison of SHA-256 digests,
`src/lib/secure-compare.ts:9-11#"timingSafeEqual(da, db)"`), then, with nothing
configured, a 500 in production or the dev default `admin`
(`src/app/api/auth/route.ts:41-57#"safeEqual(candidate, 'admin')"`).
Once a password was changed in the UI, the environment passwords are no
longer consulted. The source is chosen before the login limiter below is
asked, so a 500 for a broken store or a missing password does not use up an
attempt.

`POST /api/auth/change-password` requires a valid session, a new password
of at least 8 characters and a matching confirmation
(`src/app/api/auth/change-password/route.ts:25-26#"at least 8 characters"`).
It verifies the current password with the same chain, except that it has no
production branch: with nothing configured it compares against `admin`
(`src/app/api/auth/change-password/route.ts:57-58#"safeEqual(candidate, 'admin')"`),
and the plain and dev-default comparisons also go through `safeEqual`. In
production the startup check exits when neither `ADMIN_PASSWORD` nor
`ADMIN_PASSWORD_HASH` is set (`server.ts:20-23#"process.exit(1)"`), so this
fallback is reached only in development. The check sits behind its own limiter
instance, described below. It stores a bcrypt hash with cost 12
(`src/app/api/auth/change-password/route.ts:77#"writePasswordConfig({ hash: newHash })"`).

## Login rate limit

After the 400 checks and the choice of password source, the login route asks
`loginRateLimiter.acquire(key, parent)`; when it refuses, the route answers 429
with `Retry-After` and never calls the password check
(`src/app/api/auth/route.ts:63-68#"status: 429"`). A correct password resets
the client's keys and records them as known good (next paragraphs)
(`src/app/api/auth/route.ts:73#"loginRateLimiter.reset"`,
`src/app/api/auth/route.ts:75#"loginRateLimiter.recordSuccess"`).
The change-password route does the same admission with a second limiter instance,
`passwordChangeRateLimiter`, so the two key spaces do not share counts
(`src/app/api/auth/change-password/route.ts:62#"passwordChangeRateLimiter.acquire"`);
it never calls `recordSuccess`, so its known-good set stays empty.

The limiter (`src/lib/login-rate-limit.ts`) allows 5 attempts per key in a fixed
15-minute window, counted when admitted (before the password is checked). An
IPv6 client also carries its /48 as a parent key with a budget of 50; a request
is refused if either budget is used up and is then charged to neither. It holds
at most 10,000 keys: at the cap it drops expired entries, then the entries with
the fewest attempts that are not locked out (a locked-out key, and the keys of
the current request, are never evicted). If no room can be made, the request is
not tracked and is not let in for free either: it gets a token from
`takeUntrackedToken`, which for an unknown client is the shared overflow bucket
of one attempt per second, otherwise 429 with `Retry-After: 1`
(`src/lib/login-rate-limit.ts:2-12#"OVERFLOW_BURST"`,
`src/lib/login-rate-limit.ts:114-144#"takeUntrackedToken(key, parent, t)"`,
`src/lib/login-rate-limit.ts:229-241#"takeOverflowToken(t: number)"`).

A flood that locks every entry would leave the real admin competing for that one
token, so the limiter keeps a separate known-good set, not part of the table and
so not fillable or evictable by failed attempts. `recordSuccess(key, parent)`
is its only writer and runs only after the password was verified: it records the
key and, for IPv6, the /48 parent. The set holds at most 64 keys (least recently
successful dropped first) and forgets a key 14 days after its last success
(`src/lib/login-rate-limit.ts:13-20#"KNOWN_GOOD_GLOBAL_REFILL_MS"`,
`src/lib/login-rate-limit.ts:156-166#"recordSuccess(key: string"`,
`src/lib/login-rate-limit.ts:176-187#"knownKeyFor"`). It matters only for a
request that cannot be tracked: if its key (first) or its parent is known good,
it uses a reserved bucket instead of the shared one, with one attempt per 10 s
per known key (the key that matched, so the most specific) and one per 2 s across all
known keys; a refusal charges neither
(`src/lib/login-rate-limit.ts:198-207#"takeReservedToken(knownKey: string"`).
A known key that is tracked normally behaves like any other: its own lockout
still applies, and a known parent never lifts a locked /64. The constants are
exported and injected through the constructor, not settings. Not helped: a first
login from a new key during a flood. The reserved bucket is shared by everyone
who maps to a known key: everyone behind one public IPv4 address, and for IPv6
the known /64 or any /64 of a known /48. Such a sharer, or someone on 5 or more
known keys, can use up its attempts and keep the admin out until the flood ends,
as before. Behind a proxy with `TRUSTED_PROXY_HOPS=0`, and for the fallback key
`unknown`, all clients share one key, so recording it lets everyone behind it use
the (capped) reserved bucket. Total guessing under saturation is therefore about
3,600 per hour for unknown clients plus up to 1,800 per hour through the reserved
bucket. The set is memory only and a restart clears it, as it clears the table.

The key comes from `getClientKeys()` in `src/lib/client-ip.ts`. A route handler
cannot see the TCP peer (Next 15 gives `NextRequest` no `ip`, and its own
`x-forwarded-for` fill-in applies only when the client sent none), so the
custom server wraps its request listener in `withPeerAddress`, which writes the
socket's remote address into `x-clawd-peer-addr` for every request before
Next.js sees it, replacing a client-sent value
(`server.ts:44-47#"withPeerAddress"`). `TRUSTED_PROXY_HOPS` is read at request
time in the route graph: `0`, unset or empty uses that peer address and ignores
`X-Forwarded-For`; `N >= 1` uses the N-th entry from the right of
`X-Forwarded-For` (the list needs at least N entries; only the last N count),
falling back to the peer when there are fewer entries or the entry is not an
IP; an invalid value behaves like `0` and is logged once
(`src/lib/client-ip.ts:125-132#"getTrustedProxyHops"`,
`src/lib/client-ip.ts:147-157#"getClientKeys"`). Without a peer header all clients
share the key `unknown`. `docker-compose.traefik.yml` sets `TRUSTED_PROXY_HOPS=1`
(`docker-compose.traefik.yml:9-13#"TRUSTED_PROXY_HOPS=1"`); the plain compose
file does not. The variable is also fixed by the compose `environment:` there,
which wins over `.env` and `.env.runtime`.

## Session JWT and cookie

- The token is a JWT with `sub: 'admin'`
  (`src/app/api/auth/route.ts:77#"generateToken({ sub: 'admin' })"`), signed
  with `JWT_SECRET` and valid for 24 hours
  (`src/lib/auth.ts:28-29#"expiresIn: JWT_EXPIRES"`).
- The secret is read on first use and cached for the life of the process
  (`src/lib/auth.ts:8#"if (_jwtSecret) return _jwtSecret"`). Without
  `JWT_SECRET`, signing throws in production and verification returns no
  session (`src/lib/auth.ts:10-12#"throw new Error"`); otherwise both use a
  hard-coded dev secret (`src/lib/auth.ts:14-16#"return _jwtSecret"`).
- Login sets the cookie `token`: `httpOnly`, `secure` only when
  `NODE_ENV=production`, `sameSite: 'lax'`, `maxAge` 24 hours, `path: '/'`
  (`src/app/api/auth/route.ts:85#"path: '/'"`). `DELETE /api/auth`
  overwrites it with `maxAge: 0`
  (`src/app/api/auth/route.ts:97#"maxAge: 0"`).
- `extractToken()` takes an `Authorization: Bearer` header first, then the
  cookie (`src/lib/auth.ts:42-49#"if (cookie) return cookie.value"`).

There is no Next.js middleware. Every API route handler gates on
`isAuthenticated()` itself, except `GET /api/health`, which returns agent
counts without a session (`src/app/api/health/route.ts:6-7#"registry.getAll()"`),
and the `/api/auth` handlers: `GET` only reports whether the request is
authenticated (`src/app/api/auth/route.ts:9-10#"isAuthenticated(req)"`),
`POST` logs in
(`src/app/api/auth/route.ts:13#"export async function POST"`), and `DELETE`
clears the cookie (`src/app/api/auth/route.ts:91#"export async function DELETE"`).
The dashboard page calls `GET /api/auth` from the browser and redirects to
`/login` when the response is not OK
(`src/app/dashboard/page.tsx:31-33#"router.replace('/login')"`) or reports
no session (`src/app/dashboard/page.tsx:37-39#"router.replace('/login')"`).

## Key files

- `server.ts`, startup check, Next.js bootstrap, WebSocket upgrade.
- `src/lib/auth.ts`, JWT sign, verify, extract.
- `src/lib/data-store.ts`, `password.json` and `tokens.json`.
- `src/app/api/auth/route.ts`, login, session probe, logout.
- `src/lib/login-rate-limit.ts`, `src/lib/client-ip.ts`, `src/lib/secure-compare.ts`,
  the login limiter, its client key and the constant-time compare.
- `src/app/api/auth/change-password/route.ts`, password change.
