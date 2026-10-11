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
dev machine. Start the dev server with a writable directory set in the shell
environment, not only in `.env.local`, for example
`CLAWD_MONITOR_DATA_DIR=/path/to/writable/dir npm run dev`. If you use a
directory inside the repository, add it to `.gitignore`. The same applies to
`AGENT_TOKENS` and `AGENT_TTL_MS`: the custom server reads them before Next.js
loads `.env.local` (see [configuration.md](configuration.md)).

Without `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`, dev mode accepts the
password `admin`; without `JWT_SECRET` it signs sessions with a fixed
development secret. Do not expose a dev server.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server (`tsx server.ts`) |
| `npm run build` | Production build (`next build` + server TypeScript compile) |
| `npm start` | Run the production build (`node dist/server.js`) |
| `npm run lint` | `next lint` |
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
make docker-up     # Start via Docker Compose
make docker-down   # Stop Docker Compose
make clean         # Remove node_modules, dist and .next
```

## Pull requests

See [CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests) for the PR checklist,
the project structure, and how to add a widget.
