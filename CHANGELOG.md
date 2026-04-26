# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-04-26

**Headline: One-click "Add Agent" onboarding** — a new dashboard
modal generates a fresh agent token and renders a paste-ready
`curl … | sudo bash` one-liner that drives `clawd-monitor-agent`'s
`install.sh` on the target host. Replaces the prior two-screen
flow (Settings → generate → SSH → manual systemd write) with a
single dialog.

This release is paired with `clawd-monitor-agent v0.1.0` — that
release ships the `install.sh` script and the npm package the
snippet references. Without the agent on npm at v0.1.0 the
`npm install -g` step in the snippet would 404.

### Added

- **"+ Add Agent" navbar button** opens a two-step modal: enter a
  name, get a token + paste-ready installer command. Two copy
  buttons (token, full snippet). The token is shown once and
  cleared from in-memory state on close.
- **`buildInstallSnippet` helper** in `src/lib/install-snippet.ts`
  — pure function that swaps the dashboard's origin scheme
  (`https://` → `wss://`, `http://` → `ws://`) and shell-quotes
  the operator-supplied name. Drives both the new modal and the
  Settings → Agent Tokens snippet, so they stay byte-identical.

### Changed

- Settings → Agent Tokens snippet is now built from the same
  `buildInstallSnippet` helper. Replaces the previous hand-built
  `npm install -g clawd-monitor-agent` template that predated
  the installer script.

### Security

- The Add Agent modal explicitly disables backdrop-click and Esc
  on the snippet step. The token is shown only once and is
  unrecoverable; closing must be deliberate (Done button or `✕`).
- Plaintext token never leaves React state. Cleared on close AND
  on next open (parent keeps the modal mounted with `open=false`,
  so state could otherwise persist).
- Inline error when `window.location.origin` is empty / non-`http(s)`,
  preventing a malformed `--server ''` snippet from being rendered.
- Name field is required at the UI layer (server already 400's on
  blank). No client-side fallback — synthesizing a name would
  have leaked rough creation time / ordering via the suffix.

### Notes

- Pinning the install.sh URL: `src/lib/install-snippet.ts` points
  at `clawd-monitor-agent`'s `master` branch. A future release
  may switch to a versioned URL (`…/v0.1.0/install.sh`) to lock
  the dashboard to a known-good agent and avoid silent drift —
  trade-off documented; not changed in this release.

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
