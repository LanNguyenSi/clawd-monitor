# Contributing to clawd-monitor

Thanks for your interest!

## Development Setup

```bash
git clone https://github.com/LanNguyenSi/clawd-monitor
cd clawd-monitor
npm install
cp .env.example .env.local
# Edit .env.local: set ADMIN_PASSWORD and JWT_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). See
[docs/development.md](docs/development.md#setup) for the data directory and
the variables that must be set in the shell environment.

## Pull Requests

- Branch naming: `feat/<name>` or `fix/<name>`
- Build must pass: `npm run build`
- Type check must pass: `npm run type-check`
- Test files must type-check: `npm run type-check:tests`
- Tests must pass with coverage: `npm run test:coverage` (CI enforces the
  thresholds in `vitest.config.ts`)
- One PR per feature/fix

## Project Structure

```
src/
  app/          # Next.js App Router pages + API routes
  components/   # React components
    widgets/    # Dashboard widgets
    Grid/       # Drag-and-drop grid
    Nav/        # Navbar components
  lib/          # Shared utilities
  types/        # TypeScript types
server.ts       # Custom Next.js server (WebSocket support)
```

## Adding a Widget

1. Create `src/components/widgets/YourWidget.tsx`
2. Register in `src/lib/widgets.ts`
3. Add to `WIDGET_COMPONENTS` in `src/components/Grid/WidgetGrid.tsx`

## Agent Protocol

Agents connect via WebSocket and push snapshots. See [docs/AGENT-PROTOCOL.md](docs/AGENT-PROTOCOL.md) for the message format, and [clawd-monitor-agent](https://github.com/LanNguyenSi/clawd-monitor-agent) for the agent implementation.
