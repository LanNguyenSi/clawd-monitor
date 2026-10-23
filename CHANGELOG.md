# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **The agent log route checks the agent's gateway URL before fetching it.** `/api/agents/<id>/logs` fetched the `gatewayUrl` an agent reported at its handshake, with the agent's token, and streamed the answer to the browser, so a holder of an agent token could point the server at internal addresses. It now applies the same rule as the proxy routes (`https`, host in `ALLOWED_GATEWAY_HOSTS`, no private or loopback address) and no longer follows redirects; any other URL gets the existing "log streaming not available" lines. The handshake still accepts any `gatewayUrl`, because the agent protocol sends a loopback one. An agent whose gateway is not an allowlisted `https` host now shows "not available" in the Log Tail widget instead of its gateway logs.
- **Docker log routes validate the container name.** `/api/stream/logs` and `/api/agents/<id>/logs` pass `?container=` to `docker logs --follow`; a name starting with `-` was read as an option. A name must now match `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` (otherwise 400, and `docker` is not started) and is passed after `--`.
- **The GitHub PRs route reads its token and repositories from the environment only.** A `token` or `repos` query parameter is ignored, and a `GITHUB_REPOS` entry that is not a valid `owner/repo` is skipped.

### Fixed

- **Agents can reconnect after the server has served an HTTP request.** Next attached its own `upgrade` listener to the server on the first request, and that listener ended `/api/agents/ws` (it matches the dynamic route `/api/agents/[agentId]`), so a new agent connection closed with 1006 once any page or API call had been served; agents that reconnected after a restart or network drop stayed offline until the monitor restarted. Next is now given a separate, never-listening server and the real server has a single `upgrade` router (`src/lib/ws-upgrade.ts`). In development, other upgrades (HMR) are forwarded to Next instead of being destroyed; in production they are still destroyed.
- **Agent handshake closes with 1008 on every rejected token, and logs why the token store could not be read.** A token that failed validation (including a failed re-read of the token store after a hash match) closed the socket without a close code; it now closes with 1008 (policy violation). The warning for a failing token store read now carries the error message (never a token value), so a corrupt file and a permission error can be told apart.
- **The Docker proxy inspects containers only.** Its batched `docker inspect` passes `--type container`, so an image, volume or network that shares a name with a container id cannot answer in its place.

### Added

- **`DELETE /api/agents/<id>` removes an offline agent from the registry.** The remove button in the navbar agent switcher sent this request, but no route handled it, so the agent came back on the next 5-second poll. The route answers 200 after removing an offline agent, 409 for an agent that is online and 404 for an unknown id; the switcher keeps the entry listed on any failure other than 404.
- **`GITHUB_REPOS` and `SERVICE_HEALTH_URLS`.** The GitHub PRs widget lists the repositories in `GITHUB_REPOS` (comma-separated `owner/repo`) instead of a built-in list, and now fills its CI dot from the check runs of each PR's head commit (the token needs checks read access; a commit whose checks all passed is remembered for five minutes, so repeated polls within that window do not query it again, and a later re-run or workflow is picked up afterwards). The Service Health widget probes the URLs in `SERVICE_HEALTH_URLS` (comma-separated `[name=]url`). With either variable unset the widget shows nothing to check; deployments that relied on the old built-in lists must set them.
- **Settings shows when an agent token was last used.** A successful agent handshake with a Settings-UI token now stamps its `lastUsedAt`; the field existed in the API and page but was never written.

### Changed

- **`.env` and `.env.local` now reach the whole server.** `server.ts` loads them before any module reads its configuration, so a value set only in such a file (for example `CLAWD_MONITOR_DATA_DIR`, `AGENT_TOKENS`, `AGENT_TTL_MS`, `JWT_SECRET`) is seen by the agent WebSocket handler, the token routes and the production startup check alike. A variable already in the process environment (shell, Docker Compose) keeps its value; if the same key is also in a file, a `$` in the process value is still expanded by `dotenv-expand` (escape it as `\$` or set the key in one place). Previously only the API routes saw values from those files.
- **The memory proxy error hint no longer mentions the removed Instance Switcher**; it points to `CLAWD_DIR`, the default gateway or a connected agent. The gateway client header comment now describes the default gateway.
- **Docker widget shows the real restart count.** It matches the agent change that fills `restarts` from `docker inspect`: the `↺N` badge renders only for a positive number, so it is hidden at 0 and when the agent could not read the count. The second line now reads "created 2 hours ago" instead of a bare duration, since `uptime` holds the time since creation. The field names are unchanged. Requires the matching clawd-monitor-agent release for correct counts; the standalone host `docker` proxy now reads it the same way, with one batched `docker inspect`, instead of parsing the first number in parentheses of the `docker ps` status column (an exit code for exited containers, so a container that exited with code 137 no longer shows a bogus restart badge). `restarts` is omitted for a container whose count inspect did not return.

### Removed

- **Dead code and a broken shortcut.** The unused `InstanceSwitcher` component and `src/lib/instance.ts`, the `GET /api/agents/<id>/session-log` route (no component called it; the Session Log widget reads snapshot data), the uncalled `tryDockerLogs` helper and a stale "Wave 9" log line, and the never-used `PasswordConfig.plaintext` field are gone. The `s` (screenshot) shortcut is removed from the dashboard and the help overlay: it loaded `html2canvas`, which was never a dependency, so it did nothing.
- **Cron "trigger now" (▶) is removed from the Cron widget, and `POST /api/proxy/cron` with it.** The button posted `/cron/jobs/<id>/run` to the server's own configured gateway, never to the monitored agent's host, and OpenClaw 2026.9 has no such HTTP endpoint (404), so it could not work for remote agents. `GET /api/proxy/cron` (read-only job list) stays. A proper trigger would have to go through the agent WebSocket (server → agent → `openclaw cron run`).

### Fixed

- **Fonts are self-hosted; the build no longer fetches them from Google.** `src/app/layout.tsx` now loads Inter with `next/font/local` from woff2 files vendored in `src/fonts`, instead of `next/font/google`, which fetched every subset from Google at build time and could fail CI or a deploy when Google was unreachable. `next/font/local` cannot set a `unicode-range` per file, so each subset is its own call that pins `font-family: Inter` via `declarations` and is picked by `unicode-range`, reproducing the previous one-face-per-subset output with the same glyphs (all seven Inter subsets, latin preloaded, `display: swap`). The font is `@fontsource-variable/inter` 5.3.0 (SIL OFL 1.1; its license is vendored as `OFL-Inter.txt`); the package is not a dependency. `src/fonts/README.md` lists every file's source and how to update it. The `build` CI job gained a font guard step that fails when `next/font/google` reappears in the app source; it also fails when grep itself errors (for example an unreadable file), so it cannot silently pass. It scans `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` and `.cts` files.
- **Agent WebSocket handshake answers when the token store read throws.** The first `readTokens()` call in `src/lib/agent-ws-handler.ts` was outside a try, so a corrupt tokens file rejected the async message handler: no `auth_error` was sent, an unhandled rejection was raised, and the socket stayed open until the client timed out. Such a handshake now sends a generic `Invalid token` auth error and closes with code 1008, and access stays denied. Static `AGENT_TOKENS` are still checked before the store, so a valid static token authenticates even with a broken store.
- **Runtime env files are gitignored.** `.env.runtime` (the deploy host's secrets file that both compose files load) and backups such as `.env.runtime.bak` are now ignored, so a host checkout stays clean and a deploy-panel redeploy passes the clean-tree preflight without force (task bee5c8ad). `.env.runtime.example` stays tracked.

### Security

- **Tailwind CSS 4** (GHSA-rj75-hqrm-r3gf): the UI moves from Tailwind CSS 3.4 to 4.3 (`@tailwindcss/postcss`, theme and dark variant in `src/app/globals.css`, `tailwind.config.ts` and `autoprefixer` removed), which drops `postcss-selector-parser` 6.x from the tree. The Tailwind 3 colour palette is pinned in `@theme`, so colours are unchanged. One intentional exception: in dark mode the focused login password field no longer shows its grey border inside the focus ring (`focus:border-transparent` now takes effect).
- **next 15.5.27** (GHSA-mcj8-r9mp-w47p, GHSA-4jqv-mc3x-m676): the lockfile resolves 15.5.27 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.27`.
- **next 15.5.28** (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r): the lockfile resolves 15.5.28 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.28` (the exact `@next/env` pin moves with it), superseding the 15.5.27 entry above.
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
