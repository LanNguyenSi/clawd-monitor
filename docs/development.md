# Development

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server (`tsx server.ts`) |
| `npm run build` | Production build (`next build` + server TypeScript compile) |
| `npm start` | Run the production build (`node dist/server.js`) |
| `npm run lint` | `next lint` |
| `npm run type-check` | `tsc --noEmit` |
| `npm test` | Run the test suite once (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Make targets

Thin wrappers around the npm scripts and Docker, for convenience:

```bash
make install       # Install dependencies
make dev           # Start dev server
make build         # Production build
make typecheck     # TypeScript type check
make docker-build  # Build Docker image
make docker-up     # Start via Docker Compose
make docker-down   # Stop Docker Compose
make clean         # Remove build artifacts
```

## Pull requests

- Branch naming: `feat/<name>` or `fix/<name>`.
- Build must pass: `npm run build`.
- Type check must pass: `npm run type-check`.
- One PR per feature or fix.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the project structure and how
to add a widget.
