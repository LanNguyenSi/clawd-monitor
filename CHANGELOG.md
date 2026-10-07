# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Runtime env files are gitignored.** `.env.runtime` (the deploy host's secrets file that both compose files load) and backups such as `.env.runtime.bak` are now ignored, so a host checkout stays clean and a deploy-panel redeploy passes the clean-tree preflight without force (task bee5c8ad). `.env.runtime.example` stays tracked.

### Security

- **`npm audit` gate now classifies with an ID-scoped, dated allowlist.** The audit workflow's gate step hands `npm audit --audit-level=high --json` output to `scripts/audit-gate.mjs` (dependency-free, vendored verbatim from depsight commit be8c7ea) and reads `.github/audit-allowlist.json`. The one entry excepts GHSA-vfj7-8cjw-p6xm (`braces` 3.0.3, dev dependency only, no upstream fix) by exact advisory id until its `reviewBy` date (2026-11-06); every other HIGH or CRITICAL advisory still fails the gate, as does an expired entry. A self-test (`scripts/audit-gate.test.mjs`, `node --test`) runs in the audit job before the gate.

- The `Audit` gate is re-vendored from depsight #172: `scripts/audit-gate.mjs` now treats a report whose `metadata.vulnerabilities` HIGH plus CRITICAL tally disagrees with, or is missing against, its `vulnerabilities` map as UNCLASSIFIED (exit 3), prints npm's stderr itself through a sanitiser (each line behind an `npm stderr| ` prefix, reduced to a safe character set, length and count bounded) instead of the workflow step copying it raw, and the gate step fails (exit 3) when the classifier exits 0 without the `npm audit gate: CLEAN` line. The non-blocking report step prints npm's output between `::stop-commands::` and a per-run random resume token. The allowlist entries are unchanged. Tracker task dbbc4994.

## [0.2.2] - 2026-10-05

Patch release: security fixes in the gateway proxy and dependencies, a snapshot fix, test and CI hardening. No feature changes; the app is private and deployed from `master`, so this tag is deploy provenance.

### Security

- **Session-log route now goes through the SSRF guard.** `GET /api/agents/[agentId]/session-log` fetched the agent-registered `gatewayUrl` directly, which a connecting agent controls. It now uses `gatewayFetch`, which applies the gateway URL policy: unless the URL equals the operator-configured default gateway, it must use https, its host must be listed in `ALLOWED_GATEWAY_HOSTS`, and private, loopback and metadata targets are rejected, all before any outbound request; redirects are not followed. A rejected URL returns HTTP 502, so agents that registered an http or non-allowlisted gateway URL need `ALLOWED_GATEWAY_HOSTS` set (or an https URL) to keep their session log readable. The `limit` and `includeTools` query parameters are URL-encoded in the downstream request.
- **`isPrivateHost` detects hex-normalized IPv4-mapped IPv6.** The URL parser rewrites `::ffff:10.0.0.1` to `::ffff:a00:1`, which the guard did not match. The hex form is now decoded and checked against the private IPv4 ranges.
- **Dependency advisories closed** by in-range bumps and overrides: `esbuild` 0.28.1 via `tsx`, `js-yaml` (now 4.3.2, floor `^4.3.1`), `sharp` (override `^0.35.3`, now 0.35.4), `next` (15.5.25), `nanoid` 3.3.18, `postcss` (floor `^8.5.18`), `undici`, `brace-expansion` and `fast-uri` patched releases, and other lockfile-only audit fixes. `npm audit` is gated by a new `audit.yml` workflow.

### Changed

- `AgentSnapshot` is now derived from the zod snapshot schema (`ValidatedSnapshot`), so it includes `memoryFiles.yesterday` and cannot drift from the validated shape. No runtime change.

### Fixed

- Agent snapshots keep `memoryFiles.yesterday`; the snapshot schema used to strip the field the agent sends and the Memory widget reads.
- `PATCH /api/settings/tokens/[id]` rejects a whitespace-only `name` with HTTP 400 (`name is required`) instead of silently blanking the token name. An omitted `name` still skips the rename.
- CI now type-checks the test files (`tsconfig.test.json`, `npm run type-check:tests`), so a test that no longer matches a source type fails CI instead of only failing at runtime.
- The change-password tests no longer time out under the full coverage run: fixtures hash with bcrypt cost 4, and the tests that reach the route's cost-12 hash have an explicit timeout.
- Vitest workers disable Node's experimental webstorage, which broke the client-side lib tests on newer Node versions.

### Documentation

- README restructured, with reference material moved to `docs/`; the hero screenshot, API route inventory, env and alt-text claims, protocol example and widgets table were aligned with the code.

### Tests and CI

- Vitest with coverage is bootstrapped (`npm test`, `npm run test:coverage`) with a coverage ratchet and a CI test job; unit tests cover the SSRF guard, WebSocket auth, JWT, agent registry, password-change and token routes, and the client-side libs.
- Workflow expressions are routed out of `run:` bodies via `env`, GitHub Actions moved to Node-24-capable majors, and installs use `npm ci --no-audit --no-fund`.

## [0.2.1] - 2026-06-09

Security release closing the 2026-05-30 audit findings and a CVE sweep, plus the open source surface. The headline is three HIGH Next.js middleware/proxy-bypass CVEs. No feature changes; the app is private and deployed from `master`, so this tag is deploy provenance.

### Security

- **HIGH: three Next.js middleware/proxy-bypass CVEs patched** (PR #48). next bumped within the 15.5.x line to `^15.5.18`, resolving GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6 (Middleware/Proxy bypass, App Router) and GHSA-492v-c6pp-mqqv (dynamic routes). `npm audit` reports zero open vulnerabilities.
- **MEDIUM: SSRF / open-proxy in the gateway proxy** (PR #51, finding #41). `gatewayFetch` now validates the resolved gateway URL server-side: a caller-supplied `x-gateway-url` override must be https, present in the `ALLOWED_GATEWAY_HOSTS` allowlist, and not target loopback / link-local / private ranges; the operator-configured default stays trusted. The proxy route maps the new `GatewayUrlError` to HTTP 400.
- **MEDIUM: metrics SSE shared a CPU sampling window across connections** (PR #51, finding #42). `readCpuPercent` is now pure (previous sample in, fresh sample out) and each SSE connection holds its own `prevCpuIdle` / `prevCpuTotal`, so concurrent clients no longer share a module-global diff window.
- **ws bumped to `8.21.0`** (CVE-2026-45736, PR #50).
- **postcss bumped to `^8.5.10`** (GHSA XSS, PR #46).

### Fixed

- **Makefile `type-check` target aligned with the package.json script name** (PR #49).

### Documentation

- **Open source surface added**: Code of Conduct, security policy, and issue/PR templates (PR #47).

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
