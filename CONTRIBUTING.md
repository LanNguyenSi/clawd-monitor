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

Open [http://localhost:3000](http://localhost:3000).

## Pull Requests

- Branch naming: `feat/<name>` or `fix/<name>`
- Build must pass: `npm run build`
- Type check must pass: `npm run type-check`
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

Agents connect via WebSocket and push snapshots. See [clawd-monitor-agent](https://github.com/LanNguyenSi/clawd-monitor-agent) for the agent implementation.
