# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Deployments build the image once, from the pulled commit.** `.relay.yml` lost its only `pre_update` entry, the `docker compose -f docker-compose.traefik.yml build --no-cache` line. agent-relay runs `pre_update` against the tree from before the pull, so that build compiled the previous commit on every deploy (79 s measured) and the deploy system then built the pulled commit again (76 s). A new CI job `relay-config` (`scripts/relay-config.test.sh`, `js-yaml` added as a root devDependency) parses `.relay.yml` the way agent-relay's loader does and rejects a hook entry that is not a string, a hook key left present with no items, and any `pre_update` entry that builds images, so those mistakes fail CI instead of failing every deploy on the server. For a base-image security update or a suspected stale layer the operator runs the manual hard rebuild documented in [docs/configuration.md](docs/configuration.md#hard-rebuild-base-image-or-dependency-updates).

### Security

- **The route import allowlist no longer lets any route start a process, and everything reachable from a route through the `@/` modules is scanned.** `tests/unit/gateway-consumers.test.ts` is a text scan of every file under `src/app/api`. `child_process` was on `ALLOWED_ROUTE_IMPORTS`, so a new route could start `curl` (or any other process) and reach a gateway outside the port rule, the host allowlist and the DNS pinning; it now needs a per-file permission in `ROUTES_ALLOWED_CHILD_PROCESS`, which lists the three routes that run a local process today with the process each one runs (`src/app/api/containers/route.ts` runs `docker ps`, `src/app/api/stream/logs/route.ts` spawns `docker logs`, `journalctl` and `tail`, `src/app/api/proxy/docker/route.ts` runs `docker ps -a` and `docker inspect`); any other route that loads `child_process` fails in every loading form and the failure names the file. Every `@/` entry of `ALLOWED_ROUTE_IMPORTS`, `@/types` included, is a root of a walk over all of `src`: a specifier is resolved as `@/*` -> `src/*` or relative to the importing file over the candidates `.ts .tsx .js .jsx .mjs .cjs` and `index.*` (tsconfig has `allowJs: true`), and the walk follows the runtime imports it finds, reads each file once, and throws instead of looping if it ever reads more than four times as many files as it found. It fails closed: a relative or `@/` specifier that resolves to no file under `src` (`../server/evil`, `@/server/evil`, a broken `./evil.js` require) is an offence naming the file and specifier, not a silent drop, and a reachable file may import, as a bare module, only what is on `REACHABLE_ALLOWED_MODULES` (`jsonwebtoken`, `fs` and `path`, the non-transport modules the reachable files import today; an entry that no reachable file imports fails the test), so `axios`, `node:dns` or any client the layer does not use yet is refused, while a transport module (`net`, `tls`, `http`, `https`, `http2`, `dgram`, `child_process`, `undici` and `ws`, with or without `node:`) is named as such. A reachable file may also not call `fetch` itself, use a global `WebSocket`, `EventSource` or `XMLHttpRequest`, load a module by a computed name, or use `createRequire` or `process.binding`. `TRUSTED_REACHABLE_LIBS` maps each trusted file to the offence kinds it may have (`src/lib/gateway.ts`: the operator default fetch only; `src/lib/pinned-fetch.ts`: `module:net`, `module:undici`, `module:dns` and the fetch; `src/lib/agent-registry.ts`: `global-client-type`): a trusted file is excused only for its declared kinds, so a new capability there (a `child_process` in `gateway.ts`) is still an offence, and every declared kind is asserted to still be present, so a stale trust entry fails. A bare module import is kind `module:<name>`, so a package named like another kind (`raw-fetch`) is not excused as that kind, and every list is looked up by own key, so `constructor`, `toString` or `__proto__` is on none of them. Two erasures are bounded so they cannot hide a use: an `import type`/`export type ... from '...'` is erased only as one import head that ends at its own `from`, so neither a type alias (`export type N = number`) nor a local `export type { A }` swallows the value import or re-export that follows it; and a global client name is the weaker kind `global-client-type` only as a parameter annotation, an interface or `type Name = {` member annotation, or a generic argument, so an object-literal value (`{ c: WebSocket }`) or a ternary branch (`cond ? a : WebSocket`) is a real client, kind `global-client`, even in `agent-registry.ts`. It is still a text scan, so an obfuscated load is out of its scope and the runtime guard in `src/lib/gateway.ts` and `src/lib/pinned-fetch.ts` stays the boundary. No file under `src/` changed.
- **An agent's system log request no longer reads the dashboard host's logs.** `/api/agents/<id>/logs?source=system` started `journalctl` (then `tail /var/log/syslog`) on the clawd-monitor host for an agent that reported no `gatewayUrl`, so the user saw the host's system log labelled as the agent's. It now answers the same "not available" lines as for an agent with a gateway and starts no process, as the docker source already did. The log tail widget offers only OpenClaw while an agent is selected (docker and system would be the dashboard host's logs) and does not send an earlier docker or system choice to the agent route; without an agent all three sources work as before.

### Fixed

- **Documentation matches the code again, and the Docker data volume and `CLAWD_DIR` are documented.** `docs/ARCHITECTURE.md` no longer lists `src/lib/instance.ts` (removed in 0.3.0) and names `env-bootstrap.ts`, `ws-upgrade.ts`, `data-store.ts` and `fetcher.ts`; `CONTRIBUTING.md` no longer says the variables must be set in the shell (`.env.local` works, see `docs/development.md`); `.env.example` and `docs/configuration.md` describe `ALLOWED_GATEWAY_HOSTS` for agent-reported gateway URLs and the `x-gateway-url` header instead of the removed per-instance overrides; the README names the `SERVICE_HEALTH_URLS` variable instead of a URL list in code; the `vitest.config.ts` comments no longer point at the deleted `tests/unit/instance.test.ts` (comments only). `docs/configuration.md` gains a backup and restore recipe for the data volume (`tokens.json`, `password.json`; what `docker compose down -v` and `docker volume prune --all` delete, and how the volume is named for each compose file) and a section stating that neither compose file mounts `CLAWD_DIR`, so Alert History and the Memory Viewer filesystem fallback stay empty under Docker unless the operator adds a read-only bind mount readable by UID 1001; `.env.example` no longer suggests that a `/root/...` path works in Docker.

- **Form fields, menus, the shortcut overlay and scrollable widgets work with a screen reader and the keyboard.** The three password fields on `/settings` and the token name inputs now have labels and `autocomplete` hints (`current-password`, `new-password`), so assistive technology and password managers can tell them apart; the login field has a visually hidden label and a failed login is announced (`role="alert"`). The agent switcher, `+ Widget` and user menus announce `aria-haspopup`/`aria-expanded`, use `role="menu"`/`menuitem`, open with focus on the first item, move with the arrow keys, Home and End, close on Escape, Tab or a click outside, and return focus to their trigger; removing an offline agent from the agent switcher with the keyboard keeps focus inside the menu instead of dropping it to the page. The `?` overlay is a modal `dialog` with a name and a labelled close button, takes focus when it opens, gives it back when it closes, and also closes on a click outside it. The global shortcuts (`r`, `e`, `t`, `?`) are ignored in select elements, editable regions and while focus is inside an open menu. `/dashboard` and `/settings` have a `main` landmark and one (visually hidden) `h1`, widget titles are `h2`, and headings inside a memory file are shifted below them so the page keeps one `h1`. Every scrollable widget list is a focusable, named region with a visible focus ring, so it scrolls with the arrow keys; the widget selects and the widget remove button have accessible names. Colour contrast is not part of this change.
- **Secondary text, icon buttons and the shortcut hint meet the contrast and target-size rules.** Secondary text (timestamps, "loading", empty states, hints, badges) used `zinc-600`/`zinc-700` in dark mode (about 2:1 to 3:1 on the dark panels) and `zinc-400` in light mode; it now uses `zinc-400` on dark panels (7.6:1) and `zinc-500`/`zinc-600` in light mode, the Docker restart badge is `orange-700` in light mode, error text is `red-600` in light mode (`red-500` was about 3.8:1), the heartbeat and memory widget secondary text and the memory refresh button have a dark-mode colour too, so axe `color-contrast` reports no violation on `/login`, `/dashboard` and `/settings` in either theme at 1440 and 390 px. The widget remove cross, the agent-switcher remove cross, the shortcut overlay close, the generated-token dismiss, the add-agent dialog close, the token rename pencil and the mobile layout toggle are at least 24 by 24 px. The mobile layout toggle is named "Layout controls", reports `aria-expanded` and `aria-controls` for its panel, and the rename pencil is named "Edit name of token <name>". Emoji and symbol glyphs inside buttons, menu items and the page header (🐾, ✏️, 🔒, ☀️, 🌙, ⚙️, 💤, ✕, ☰) and the drag-handle dots and status dots are hidden from assistive technology (`aria-hidden`), the text beside them carries the name. The "Press ? for shortcuts" hint is no longer fixed to the bottom right corner where it covered the last widget row; it sits below the grid. Colour contrast was left out of the previous accessibility change and is now covered.
- **Success, warning and error text meets 4.5:1 in the light scheme.** `green-600` (3.3:1 on white) was used for the OK state of the service health and heartbeat widgets, the low-usage metrics value and the password-change success message, `yellow-600`/`yellow-500` (about 2:1 to 3:1) for warnings, and `red-600` for error text, which is only 4.4:1 on the `red-50` login alert and on the grey page background. They are now `green-700`, `yellow-800` and `red-700` in the light scheme (the dark scheme is unchanged), and the hover colour of the white-on-indigo buttons is `indigo-700` (`indigo-500` is 4.46:1); the `agent` badge of the log tail widget has a light-scheme colour pair (it was `indigo-400` on a translucent dark tint, 1.7:1), and the secondary text of the active row in the connected agents widget is `zinc-600` on its `indigo-50` surface (`zinc-500` is 4.3:1 there). The contrast test now checks every string literal on its own, so a ternary branch without a `dark:` partner no longer passes because its sibling has one, and it computes the WCAG ratio of each coloured text class against its own surface.
- **A narrow window no longer destroys the desktop widget layout.** The dashboard saved the layout react-grid-layout had clamped to the current width (one column at 390 px) as the only layout, so returning to a wide window left every widget in one narrow column until `localStorage` was cleared. Layouts are now stored per breakpoint under `clawd-monitor:layouts`; a visit at a small width changes only that breakpoint's entry. A layout saved in the old single-array format is read as the `lg` layout, unreadable data falls back to the default layout, and the "+ Widget" menu writes the same per-breakpoint format. A new "Reset layout" button next to the edit toggle (also in the mobile layout menu) restores the default layout after a confirmation prompt (cancelling changes nothing). A layout already clamped to one column by the old behaviour stays that way until it is reset.
- **Revoking an agent token asks first, names the token and reports failures.** The `Revoke` button on `/settings` sent the `DELETE` at once, so a mis-click cut an agent off; it now asks for confirmation naming the token (cancelling changes nothing). Each button is named for its token (`Revoke token vps-main`) instead of three identical `Revoke` buttons. If the server answers with an error or the request fails, an alert says so and the token stays in the list instead of the failure being silent. While a revoke is running the buttons are marked `aria-disabled` and further clicks are ignored, and a previous error is cleared when the next revoke starts, even if its confirmation is cancelled. The button text is red (`red-700` in the light scheme, `red-400` in the dark one) and meets the 4.5:1 contrast ratio in both; before it was grey (`zinc-400` / `zinc-600`) and failed in both.

## [0.3.0] - 2026-10-25

### Security

- **The agent log route checks the agent's gateway URL before fetching it.** `/api/agents/<id>/logs` fetched the `gatewayUrl` an agent reported at its handshake, with the agent's token, and streamed the answer to the browser, so a holder of an agent token could point the server at internal addresses. It now applies the same rule as the proxy routes (`https`, host in `ALLOWED_GATEWAY_HOSTS`, no private or loopback address) and no longer follows redirects. Unlike the proxy routes, the operator's default gateway URL gets no exception here: an agent that reports a URL equal to `NEXT_PUBLIC_DEFAULT_GATEWAY_URL` is held to the same rule, so it cannot make the server fetch the default gateway with the agent's token; any other URL gets the existing "log streaming not available" lines. The handshake still accepts any `gatewayUrl`, because the agent protocol sends a loopback one. An agent whose gateway is not an allowlisted `https` host now shows "not available" in the Log Tail widget instead of its gateway logs.
- **The docker log source validates the container name.** `/api/stream/logs` passes `?container=` to `docker logs --follow`; a name starting with `-` was read as an option (the agent route no longer starts docker, see below). A name must now match `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` (otherwise 400, and `docker` is not started) and is passed after `--`.
- **The GitHub PRs route reads its token and repositories from the environment only.** A `token` or `repos` query parameter is ignored, and a `GITHUB_REPOS` entry that is not a valid `owner/repo` is skipped.
- **The gateway URL guard resolves host names and checks ports.** A name in `ALLOWED_GATEWAY_HOSTS` that resolved (or was rebound) to a loopback, private, link-local, carrier-grade NAT, unspecified, multicast, reserved, documentation, benchmarking, Teredo, 6to4 relay or other non-public address was fetched anyway, and any port of an allowlisted host was accepted. Every gateway URL other than the operator default is now fetched with undici's `fetch` over a dedicated undici `Agent` whose connections resolve the host once, in the lookup the connection itself uses: if any answer is non-public the request is rejected, otherwise the connection goes to exactly the checked addresses, so DNS rebinding between check and connect is not possible (TLS still verifies the certificate against the host name, redirects are still not followed). An IPv6 address counts as public only inside the global unicast range `2000::/3`, and there not inside `2001::/23` (the IETF protocol assignments block: Teredo, benchmarking, ORCHID and the rest), except for the sub-blocks IANA marks globally reachable (`2001:1::1`, `2001:1::2`, `2001:1::3`, `2001:3::/32`, `2001:4:112::/48`, `2001:20::/28`, `2001:30::/28`), nor inside the documentation ranges `2001:db8::/32` and `3fff::/20`. IPv4-mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses are judged by the IPv4 address they carry; the deprecated IPv4-compatible range `::/96` (`::a.b.c.d`) is never public, whatever it spells, so `::8.8.8.8` is now rejected. Such a request has the same time limits as the global fetch: 10 seconds to connect, 300 seconds for the response headers and 300 seconds without a byte while the body is read; status lines, informational and upgrade answers and the release of the connection are handled by `fetch` itself. `ALLOWED_GATEWAY_HOSTS` entries may carry a port (`host:port`); an entry without a port now allows port 443 only, an entry with a port allows only that port. Operator note: a gateway override on another port needs its `host:port` entry, and an allowlisted name that resolves to a private address (an internal gateway reached by name) is now rejected. The operator default gateway URL is unchanged.
- **Agent-reported gateway URLs always go through `remoteGatewayFetch`.** The default-URL exemption of `assertGatewayUrlAllowed` is no longer an opt-out: the `trustDefault` option is required, `assertRemoteGatewayUrl` and `remoteGatewayFetch` apply the full rule without it, and `gatewayFetch` requires a `urlSource` (`'operator'` or `'remote'`) whenever a `gatewayUrl` is passed, so a new caller cannot get the exemption by leaving the decision out: omitting it is a compile error, and a caller that bypasses the types gets no exemption at run time. The proxy routes and the stream log route pass `'operator'`, as before.
- **The agent log route no longer starts `docker logs`.** With an agent selected, `source=docker` read the containers of the clawd-monitor host for any signed-in user. `/api/agents/<id>/logs?source=docker` now answers two "not available" lines and never starts `docker` (it is not forwarded to the agent's gateway either); the Docker source of the Log Tail widget works without an agent selected, as before.
- **The log routes accept only known sources.** `/api/agents/<id>/logs` put the `source` query value into the agent's gateway URL unencoded; both log routes now answer 400 for a `source` other than `openclaw`, `docker` or `system`.
- **zod 4.6.7** (GHSA-mrhx-c7xc-m3w5): the lockfile resolves 4.6.7, so validating an oversized constrained collection no longer exhausts memory.
- **Tailwind CSS 4** (GHSA-rj75-hqrm-r3gf): the UI moves from Tailwind CSS 3.4 to 4.3 (`@tailwindcss/postcss`, theme and dark variant in `src/app/globals.css`, `tailwind.config.ts` and `autoprefixer` removed), which drops `postcss-selector-parser` 6.x from the tree. The Tailwind 3 colour palette is pinned in `@theme`, so colours are unchanged. One intentional exception: in dark mode the focused login password field no longer shows its grey border inside the focus ring (`focus:border-transparent` now takes effect).
- **next 15.5.27** (GHSA-mcj8-r9mp-w47p, GHSA-4jqv-mc3x-m676): the lockfile resolves 15.5.27 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.27`.
- **next 15.5.28** (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r): the lockfile resolves 15.5.28 with its matching `@next/env` and `@next/swc-*` packages and the `next` dependency floor is now `^15.5.28` (the exact `@next/env` pin moves with it), superseding the 15.5.27 entry above.
- **`npm audit` gate now classifies with an ID-scoped, dated allowlist.** The audit workflow's gate step hands `npm audit --audit-level=high --json` output to `scripts/audit-gate.mjs` (dependency-free, vendored verbatim from depsight commit be8c7ea) and reads `.github/audit-allowlist.json`. The one entry excepts GHSA-vfj7-8cjw-p6xm (`braces` 3.0.3, dev dependency only, no upstream fix) by exact advisory id until its `reviewBy` date (2026-11-06); every other HIGH or CRITICAL advisory still fails the gate, as does an expired entry. A self-test (`scripts/audit-gate.test.mjs`, `node --test`) runs in the audit job before the gate.

- The `Audit` gate is re-vendored from depsight #172: `scripts/audit-gate.mjs` now treats a report whose `metadata.vulnerabilities` HIGH plus CRITICAL tally disagrees with, or is missing against, its `vulnerabilities` map as UNCLASSIFIED (exit 3), prints npm's stderr itself through a sanitiser (each line behind an `npm stderr| ` prefix, reduced to a safe character set, length and count bounded) instead of the workflow step copying it raw, and the gate step fails (exit 3) when the classifier exits 0 without the `npm audit gate: CLEAN` line. The non-blocking report step prints npm's output between `::stop-commands::` and a per-run random resume token. The allowlist entries are unchanged. Tracker task dbbc4994.

### Removed

- **Dead code and a broken shortcut.** The unused `InstanceSwitcher` component and `src/lib/instance.ts`, the `GET /api/agents/<id>/session-log` route (no component called it; the Session Log widget reads snapshot data), the uncalled `tryDockerLogs` helper and a stale "Wave 9" log line, and the never-used `PasswordConfig.plaintext` field are gone. The `s` (screenshot) shortcut is removed from the dashboard and the help overlay: it loaded `html2canvas`, which was never a dependency, so it did nothing.
- **Cron "trigger now" (▶) is removed from the Cron widget, and `POST /api/proxy/cron` with it.** The button posted `/cron/jobs/<id>/run` to the server's own configured gateway, never to the monitored agent's host, and OpenClaw 2026.9 has no such HTTP endpoint (404), so it could not work for remote agents. `GET /api/proxy/cron` (read-only job list) stays. A proper trigger would have to go through the agent WebSocket (server → agent → `openclaw cron run`).

### Added

- **`DELETE /api/agents/<id>` removes an offline agent from the registry.** The remove button in the navbar agent switcher sent this request, but no route handled it, so the agent came back on the next 5-second poll. The route answers 200 after removing an offline agent, 409 for an agent that is online and 404 for an unknown id; the switcher keeps the entry listed on any failure other than 404.
- **`GITHUB_REPOS` and `SERVICE_HEALTH_URLS`.** The GitHub PRs widget lists the repositories in `GITHUB_REPOS` (comma-separated `owner/repo`) instead of a built-in list, and now fills its CI dot from the check runs of each PR's head commit (the token needs checks read access; a commit whose checks all passed is remembered for five minutes, so repeated polls within that window do not query it again, and a later re-run or workflow is picked up afterwards). The Service Health widget probes the URLs in `SERVICE_HEALTH_URLS` (comma-separated `[name=]url`). With either variable unset the widget shows nothing to check; deployments that relied on the old built-in lists must set them.
- **Settings shows when an agent token was last used.** A successful agent handshake with a Settings-UI token now stamps its `lastUsedAt`; the field existed in the API and page but was never written.

### Changed

- **New runtime dependency `undici` (6.x).** The pinned gateway requests use the `undici` package's `fetch` and `Agent`: a connect-time lookup needs an undici `Agent`, which Node does not export. 6.x is the major line Node 20 bundles; older 6.x releases carry known advisories, so the dependency starts at a release without them. The gateway proxy and log routes now cancel the body of a non-OK gateway answer they do not read, so its connection is released at once instead of when the response is garbage-collected.
- **`.env` and `.env.local` now reach the whole server.** `server.ts` loads them before any module reads its configuration, so a value set only in such a file (for example `CLAWD_MONITOR_DATA_DIR`, `AGENT_TOKENS`, `AGENT_TTL_MS`, `JWT_SECRET`) is seen by the agent WebSocket handler, the token routes and the production startup check alike. A variable already in the process environment (shell, Docker Compose) keeps its value; if the same key is also in a file, a `$` in the process value is still expanded by `dotenv-expand` (escape it as `\$` or set the key in one place). Previously only the API routes saw values from those files.
- **The memory proxy error hint no longer mentions the removed Instance Switcher**; it points to `CLAWD_DIR`, the default gateway or a connected agent. The gateway client header comment now describes the default gateway.
- **Docker widget shows the real restart count.** It matches the agent change that fills `restarts` from `docker inspect`: the `↺N` badge renders only for a positive number, so it is hidden at 0 and when the agent could not read the count. The second line now reads "created 2 hours ago" instead of a bare duration, since `uptime` holds the time since creation. The field names are unchanged. Requires the matching clawd-monitor-agent release for correct counts; the standalone host `docker` proxy now reads it the same way, with one batched `docker inspect`, instead of parsing the first number in parentheses of the `docker ps` status column (an exit code for exited containers, so a container that exited with code 137 no longer shows a bogus restart badge). `restarts` is omitted for a container whose count inspect did not return.

### Fixed

- **Agents can reconnect after the server has served an HTTP request.** Next attached its own `upgrade` listener to the server on the first request, and that listener ended `/api/agents/ws` (it matches the dynamic route `/api/agents/[agentId]`), so a new agent connection closed with 1006 once any page or API call had been served; agents that reconnected after a restart or network drop stayed offline until the monitor restarted. Next is now given a separate, never-listening server and the real server has a single `upgrade` router (`src/lib/ws-upgrade.ts`). In development, other upgrades (HMR) are forwarded to Next instead of being destroyed; in production they are still destroyed.
- **Agent handshake closes with 1008 on every rejected token, and logs why the token store could not be read.** A token that failed validation (including a failed re-read of the token store after a hash match) closed the socket without a close code; it now closes with 1008 (policy violation). The warning for a failing token store read now carries the error message (never a token value), so a corrupt file and a permission error can be told apart.
- **The Docker proxy inspects containers only.** Its batched `docker inspect` passes `--type container`, so an image, volume or network that shares a name with a container id cannot answer in its place.
- **Fonts are self-hosted; the build no longer fetches them from Google.** `src/app/layout.tsx` now loads Inter with `next/font/local` from woff2 files vendored in `src/fonts`, instead of `next/font/google`, which fetched every subset from Google at build time and could fail CI or a deploy when Google was unreachable. `next/font/local` cannot set a `unicode-range` per file, so each subset is its own call that pins `font-family: Inter` via `declarations` and is picked by `unicode-range`, reproducing the previous one-face-per-subset output with the same glyphs (all seven Inter subsets, latin preloaded, `display: swap`). The font is `@fontsource-variable/inter` 5.3.0 (SIL OFL 1.1; its license is vendored as `OFL-Inter.txt`); the package is not a dependency. `src/fonts/README.md` lists every file's source and how to update it. The `build` CI job gained a font guard step that fails when `next/font/google` reappears in the app source; it also fails when grep itself errors (for example an unreadable file), so it cannot silently pass. It scans `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` and `.cts` files.
- **Agent WebSocket handshake answers when the token store read throws.** The first `readTokens()` call in `src/lib/agent-ws-handler.ts` was outside a try, so a corrupt tokens file rejected the async message handler: no `auth_error` was sent, an unhandled rejection was raised, and the socket stayed open until the client timed out. Such a handshake now sends a generic `Invalid token` auth error and closes with code 1008, and access stays denied. Static `AGENT_TOKENS` are still checked before the store, so a valid static token authenticates even with a broken store.
- **Runtime env files are gitignored.** `.env.runtime` (the deploy host's secrets file that both compose files load) and backups such as `.env.runtime.bak` are now ignored, so a host checkout stays clean and a deploy-panel redeploy passes the clean-tree preflight without force (task bee5c8ad). `.env.runtime.example` stays tracked.

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
