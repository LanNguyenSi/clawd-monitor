# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-15

**Headline: First tagged release of clawd-monitor — a web-based
monitoring dashboard for OpenClaw instances with live widgets,
multi-instance support, drag-and-drop layouts, and
production-ready auth, deployed via Traefik + agent-relay.**

This is the baseline release. Everything below describes what the
dashboard ships with today.

### Added

#### Dashboard UX

- **Live monitoring widgets** — customizable grid layout via
  `react-grid-layout` (drag & drop, resize) with SWR-backed data
  and WebSocket live updates (`ws`).
- **Multi-instance support** — a single dashboard can monitor
  several OpenClaw hosts at once, with per-instance widgets.
- **Log tail widget** — system log tail and Docker log tail with
  a container dropdown; supports remote agents.
- **Memory viewer** — inspects today and yesterday log snapshots
  from the agent.
- **Auto-scroll** — contained within each widget, uses `scrollTop`
  rather than `scrollIntoView` so focus stays put.
- **Markdown rendering** via `react-markdown`.

#### Auth & session

- **httpOnly cookie session flow** — password + JWT auth
  (`bcryptjs` + `jsonwebtoken`), with auto-redirect to login on
  session expiry and tidy agent-reconnect state.

#### WebSocket stability

- **Reconnect race fixes** — old WebSockets tear down silently
  without killing new connections, and HTTP/2 is disabled via the
  Traefik TLS option to avoid head-of-line blocking instabilities.

#### Developer experience

- **`Makefile`** with a Make targets section in the README.
- **OS-ready repo** — `LICENSE`, `CONTRIBUTING.md`, canonical
  `docker-compose.yml`, internal docs pruned.
- **Zod** runtime schemas and strict `zod@4` for input validation.

#### Ops & deployment

- **Traefik + agent-relay deployment** — `.relay.yml` descriptor
  consumed by `agent-relay`; `docker-compose.traefik.yml` with
  `DOMAIN` env var (no hard-coded domain); `.env.runtime` loaded
  in compose; `docker-ce-cli` installed for Docker 29.x API
  compatibility.
- **External data volume** — password and tokens survive redeploys.

### Security

- **Hardening pass** — security, validation, and resilience
  improvements across auth, input handling, and error paths.
- Bump `next` to 15.5.15 to address **GHSA-q4gf-8mx6-v5v3**
  (high-severity DoS via Server Components, affects
  `>=13.0.0 <15.5.15`).

### Release infrastructure

- This release introduces `.github/workflows/release.yml`, triggered
  on `v*` tags. It reuses the existing `ci.yml` via `workflow_call`,
  extracts this CHANGELOG section for the tagged version, and
  publishes the GitHub Release via `softprops/action-gh-release@v2`.
- Root `package.json` version aligned at `0.1.0` to match the tag
  (bumped down from the initial boilerplate `1.0.0`).
