# Development

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Agent tokens and a changed admin password are written to
`CLAWD_MONITOR_DATA_DIR` (default `/data`), which is usually not writable on a
dev machine. Set a writable directory in `.env.local` or in the shell, for
example `CLAWD_MONITOR_DATA_DIR=/path/to/writable/dir npm run dev`. If you use
a directory inside the repository, add it to `.gitignore`. The custom server
loads `.env.local` before it reads `CLAWD_MONITOR_DATA_DIR`, `AGENT_TOKENS` and
`AGENT_TTL_MS`; a value already in the shell environment wins (see
[configuration.md](configuration.md)).

Without `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`, dev mode accepts the
password `admin`; without `JWT_SECRET` it signs sessions with a fixed
development secret. Do not expose a dev server.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server (`tsx server.ts`) |
| `npm run build` | Production build (`next build` + server TypeScript compile) |
| `npm start` | Run the production build (`node dist/server.js`); set `NODE_ENV=production` for production behaviour |
| `npm run lint` | `eslint .` (flat config, `eslint.config.mjs`) |
| `npm run type-check` | `tsc --noEmit` |
| `npm run type-check:tests` | Type-check the test files (`tsc --noEmit -p tsconfig.test.json`) |
| `npm test` | Run the test suite once (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Make targets

Thin wrappers around the npm scripts and Docker, for convenience:

```bash
make install       # Install dependencies
make dev           # Start dev server
make build         # Production build
make test          # Run the test suite
make typecheck     # TypeScript type check
make docker-build  # Build Docker image
make docker-up     # Start the local plain-HTTP stack (project clawd-monitor-local)
make docker-down   # Stop that stack
make clean         # Remove node_modules, dist and .next
```

A stack started earlier with a bare `docker compose up -d` (before
`docker-compose.yml` carried `name: clawd-monitor-local`) runs under the
directory's project name `clawd-monitor`; stop it once with
`docker compose -p clawd-monitor down` before the first `make docker-up`, or the
two compete for port 3000. Now that the file has its own project name, a bare
`docker compose` here follows that name and no longer reaches the production
containers, which run under `clawd-monitor` from `docker-compose.traefik.yml`.
The plain stack publishes `127.0.0.1:3000` only, so it serves the host it runs
on.

## Pull requests

See [CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests) for the PR checklist,
the project structure, and how to add a widget.
