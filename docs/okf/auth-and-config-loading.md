---
type: module
title: Auth and config loading across the two module graphs
description: Admin password precedence, the password.json and tokens.json data files, JWT cookie flags and lifetime, the production startup check, and how the custom server loads .env files before its modules read the environment, while the compiled route graph reads its own variables later.
tags: [auth, config, env, jwt, startup]
timestamp: 2026-10-30T21:43:40Z
sources:
  - server.ts
  - tsconfig.server.json
  - package.json
  - Dockerfile
  - docker-compose.yml
  - docker-compose.traefik.yml
  - src/lib/auth.ts
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
  (`server.ts:11-13#"process.env.HOSTNAME"`) and runs the startup check on
  `JWT_SECRET`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH` and, in development
  only, `AGENT_TOKENS` (`server.ts:16-27#"AGENT_TOKENS not set"`) before it
  calls
  `next({ dev, hostname, port, httpServer: nextServer })` (`server.ts:35#"next({ dev, hostname, port"`).
- Its static import of the WebSocket handler (`server.ts:8#"handleAgentConnection"`)
  evaluates three more module-level reads: `AGENT_TOKENS`
  (`src/lib/agent-ws-handler.ts:9-12#".filter(Boolean)"`), `AGENT_TTL_MS`
  (`src/lib/agent-registry.ts:22#"AGENT_TTL_MS"`) and
  `CLAWD_MONITOR_DATA_DIR` (`src/lib/data-store.ts:5#"CLAWD_MONITOR_DATA_DIR"`).

Because the bootstrap import is first, a variable set only in a `.env` or
`.env.local` file reaches both graphs: the startup check, the handshake's
`STATIC_TOKENS`, the registry's `AGENT_TTL_MS`, and the data directory the
handshake and the token routes share. Next.js later calls the same loader
for its own graph; it finds the files already loaded.

The route-graph-only variables (`DEFAULT_GATEWAY_TOKEN` in
`src/lib/gateway.ts:9#"DEFAULT_GATEWAY_TOKEN"`, `ALLOWED_GATEWAY_HOSTS` in
`src/lib/gateway.ts:47#"process.env.ALLOWED_GATEWAY_HOSTS"`, `CLAWD_DIR` in
`src/app/api/proxy/memory/route.ts:9#"CLAWD_DIR"` and
`src/app/api/proxy/alert-history/route.ts:8#"CLAWD_DIR"`, `GITHUB_TOKEN` in
`src/app/api/proxy/github/route.ts:84#"process.env.GITHUB_TOKEN"`) are read
by the routes at request time. `NEXT_PUBLIC_DEFAULT_GATEWAY_URL`
(`src/lib/gateway.ts:8#"NEXT_PUBLIC_DEFAULT_GATEWAY_URL"`) is the exception
in the other direction: when it is set while `next build` runs, Next.js
inlines its build-time value into the compiled code, and a later runtime
value does not replace it.

Under Docker the environment is already complete at process start: the runtime stage copies only `.next`,
`public`, `node_modules`, `package.json` and `dist`
(`Dockerfile:43-48#"COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist"`),
and both compose files pass the environment through `environment:` and
`env_file:` so it is in `process.env` when the process starts
(`docker-compose.yml:11-19#"path: .env.runtime"`,
`docker-compose.traefik.yml:6-15#"path: .env.runtime"`). Both set
`CLAWD_MONITOR_DATA_DIR=/data` explicitly
(`docker-compose.yml:13#"CLAWD_MONITOR_DATA_DIR=/data"`).

## Data files

The image ships `/data` owned by the app user, created before `USER`
(`Dockerfile:40#"RUN mkdir -p /data && chown nextjs:nodejs /data"`), so a named
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
  (`src/lib/data-store.ts:146#"'password.json'"`).
- `tokens.json` holds the agent tokens created in the settings UI, each as
  a bcrypt hash with cost 10
  (`src/app/api/settings/tokens/route.ts:46#"bcrypt.hash(rawToken, 10)"`);
  the raw token is returned once, in the `POST` response. A successful
  handshake with such a token stamps its `lastUsedAt`
  (`src/lib/agent-ws-handler.ts:93#"current.lastUsedAt"`), which the `GET`
  list returns and the settings page shows.

## Admin password precedence

`POST /api/auth` checks, in order: the `password.json` hash, then
`ADMIN_PASSWORD_HASH` (bcrypt), then `ADMIN_PASSWORD` (plain string
comparison), then, with nothing configured, a 500 in production or the dev
default `admin` (`src/app/api/auth/route.ts:36-48#"valid = password === 'admin'"`).
Once a password was changed in the UI, the environment passwords are no
longer consulted.

`POST /api/auth/change-password` requires a valid session, a new password
of at least 8 characters and a matching confirmation
(`src/app/api/auth/change-password/route.ts:22-23#"at least 8 characters"`).
It verifies the current password with the same chain, except that it has no
production branch: with nothing configured it compares against `admin`
(`src/app/api/auth/change-password/route.ts:42-50#"currentPassword === 'admin'"`).
In production the startup check exits when neither `ADMIN_PASSWORD` nor
`ADMIN_PASSWORD_HASH` is set (`server.ts:19-22#"process.exit(1)"`), so this
fallback is reached only in development.
It stores a bcrypt hash with cost 12
(`src/app/api/auth/change-password/route.ts:58-59#"writePasswordConfig({ hash: newHash })"`).

## Session JWT and cookie

- The token is a JWT with `sub: 'admin'`
  (`src/app/api/auth/route.ts:55#"generateToken({ sub: 'admin' })"`), signed
  with `JWT_SECRET` and valid for 24 hours
  (`src/lib/auth.ts:28-29#"expiresIn: JWT_EXPIRES"`).
- The secret is read on first use and cached for the life of the process
  (`src/lib/auth.ts:8#"if (_jwtSecret) return _jwtSecret"`). Without
  `JWT_SECRET`, signing throws in production and verification returns no
  session (`src/lib/auth.ts:10-12#"throw new Error"`); otherwise both use a
  hard-coded dev secret (`src/lib/auth.ts:14-16#"return _jwtSecret"`).
- Login sets the cookie `token`: `httpOnly`, `secure` only when
  `NODE_ENV=production`, `sameSite: 'lax'`, `maxAge` 24 hours, `path: '/'`
  (`src/app/api/auth/route.ts:58-63#"path: '/'"`). `DELETE /api/auth`
  overwrites it with `maxAge: 0`
  (`src/app/api/auth/route.ts:70-75#"maxAge: 0"`).
- `extractToken()` takes an `Authorization: Bearer` header first, then the
  cookie (`src/lib/auth.ts:42-49#"if (cookie) return cookie.value"`).

There is no Next.js middleware. Every API route handler gates on
`isAuthenticated()` itself, except `GET /api/health`, which returns agent
counts without a session (`src/app/api/health/route.ts:6-7#"registry.getAll()"`),
and the `/api/auth` handlers: `GET` only reports whether the request is
authenticated (`src/app/api/auth/route.ts:6-7#"isAuthenticated(req)"`),
`POST` logs in
(`src/app/api/auth/route.ts:10#"export async function POST"`), and `DELETE`
clears the cookie (`src/app/api/auth/route.ts:69#"export async function DELETE"`).
The dashboard page calls `GET /api/auth` from the browser and redirects to
`/login` when the response is not OK
(`src/app/dashboard/page.tsx:31-33#"router.replace('/login')"`) or reports
no session (`src/app/dashboard/page.tsx:37-39#"router.replace('/login')"`).

## Key files

- `server.ts`, startup check, Next.js bootstrap, WebSocket upgrade.
- `src/lib/auth.ts`, JWT sign, verify, extract.
- `src/lib/data-store.ts`, `password.json` and `tokens.json`.
- `src/app/api/auth/route.ts`, login, session probe, logout.
- `src/app/api/auth/change-password/route.ts`, password change.
