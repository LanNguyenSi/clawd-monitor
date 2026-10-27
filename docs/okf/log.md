# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-27T06:55:27Z, auth-and-config-loading and agent-registry-lifecycle re-verified and re-stamped after the data
  store changed again. The temp file of a write is named with random bytes (not pid and counter)
  and an existing name is skipped, never written to or deleted; `readTokens` requires every entry
  to be an object with string `id`, `name`, `tokenHash` and `createdAt`, and
  `readPasswordConfig` requires `hash` to be absent or a non-empty string, so the handshake
  rejects a list with a `null` entry instead of throwing. The stray-temp name and the wrong-shape
  claims were updated and the citations of the moved `data-store.ts` lines were re-pointed.
  Checked with `git diff c813c356..HEAD` on those files.
- 2026-10-27T06:44:23Z, auth-and-config-loading and agent-registry-lifecycle re-verified and re-stamped after
  the data store changed. `writeDataFile` replaces files through a same-directory temp file
  (fsync, rename, always mode 0600); `readDataFile` returns the default only for a missing file
  and throws `DataFileError` for an empty, unparseable, wrong-shaped or unreadable one, which the
  token and password routes turn into a logged 500 and the agent handshake into a rejection with
  the reason in the log. The "existing file keeps its permissions" and "corrupt reads as empty"
  claims were replaced, and the citations of the moved lines in `data-store.ts` and the three
  routes were re-pointed. Checked with `git diff 23eedfae..HEAD` on those files.
- 2026-10-26T13:17:53Z, agent logs `system` source never spawns: `widget-data-modes.md` and
  `agent-registry-lifecycle.md` re-verified and re-stamped. The agent route answers
  `system` with two info lines for every agent and imports no `child_process`; the
  widget offers only OpenClaw while an agent is selected. The route citations
  (body cancel, gateway fetch) were re-pointed to the shifted lines. The other widget files newer
  than the previous stamp only changed colour classes in place (light-mode contrast,
  `git show 8380b49`); their polling and data-mode claims are unchanged.
- 2026-10-26T13:15:50Z, auth-and-config-loading re-verified and re-stamped after `package.json`
  gained `js-yaml` as a root devDependency for the relay-config CI guard. No
  script, env loading or auth dependency changed; the doc's claims are unchanged.
- 2026-10-26T09:24:32Z, widget-data-modes re-verified and re-stamped after the light-scheme
  contrast follow-up. `HeartbeatWidget.tsx`, `LogTailWidget.tsx`,
  `MetricsWidget.tsx`, `ServiceHealthWidget.tsx` and `AgentListWidget.tsx`
  only changed colour classes in place (`green-700`, `yellow-800`, `red-700`
  text, a light colour pair for the log tail badge, `zinc-600` row text); no
  line moved, the polling and data-mode claims of the doc are unchanged.
  Checked with `git diff 43d9cec..HEAD` on those files.
- 2026-10-26T09:05:52Z, widget-data-modes re-verified and re-stamped after the contrast sweep
  follow-up. `HeartbeatWidget.tsx`, `MemoryWidget.tsx`, `LogTailWidget.tsx`
  and `SessionLogWidget.tsx` only gained or changed colour classes in place
  (dark text pair, dark hover colour, `red-600` error text); no line moved,
  the polling and data-mode claims of the doc are unchanged. Checked with
  `git diff e47b688..HEAD` on the four files.
- 2026-10-26T08:52:48Z, auth-and-config-loading, widget-data-modes and agent-registry-lifecycle
  re-verified and re-stamped after the contrast and icon-button change.
  The edits to `dashboard/page.tsx`, `AgentSwitcher.tsx`, `Navbar.tsx` and
  the widget files swap colour classes, add `aria-*` attributes and wrap
  glyphs in spans in place, and move the shortcut hint into the page flow;
  no line count changed, the cited `router.replace` lines, the
  `<ActiveAgentProvider>` line, the AgentSwitcher storage and `DELETE`
  lines and the Navbar imports (4-7) are where the docs cite them, the
  offline-only remove button still sends `DELETE`, and the navbar still
  mounts `AgentSwitcher`, `AddWidgetMenu` and `UserMenu`. Checked with
  `okf-kit check docs/okf`: clean.

- 2026-10-26T08:36:30Z, auth-and-config-loading, widget-data-modes and agent-registry-lifecycle
  re-verified and re-stamped after merging the dashboard layout change into
  the accessibility branch. In `src/app/dashboard/page.tsx` the `main`
  landmark and the moved shortcut hint add one line before
  `<ActiveAgentProvider>`, so that citation in widget-data-modes now reads
  line 145; the `router.replace('/login')` citations (31-33, 37-39) and the
  AgentSwitcher citations did not move. `Navbar.tsx` still mounts
  `AgentSwitcher`, `AddWidgetMenu` and `UserMenu`. Checked with
  `okf-kit check docs/okf`.
- 2026-10-26T08:35:46Z, widget-data-modes, agent-registry-lifecycle and auth-and-config-loading
  re-verified and re-stamped after a follow-up to the accessibility change:
  `src/components/Nav/AgentSwitcher.tsx` now moves keyboard focus to the
  nearest remaining menu item after an offline agent is removed (or to the
  trigger when the removed agent was the selected one). Checked against the
  code: the remove button still sends `DELETE` and drops the entry on 404 or
  success only, the selection is still persisted through `select()`, and the
  `localStorage` citations (`:48-50`, `:54-56`) did not move. The `DELETE`
  citation in agent-registry-lifecycle moved from `:64-65` to `:78-79` and
  was re-pointed. widget-data-modes cites no changed line;
  auth-and-config-loading does not depend on the file. Checked with
  `okf-kit check docs/okf`.
- 2026-10-26T08:27:20Z, widget-data-modes, agent-registry-lifecycle and auth-and-config-loading
  re-verified and re-stamped after an accessibility change to
  `src/app/dashboard/page.tsx`, `src/components/Nav/AgentSwitcher.tsx` and the
  scrollable widget lists (a `ScrollRegion` wrapper, an `aria-label` on the
  selects, a `main` landmark with a hidden h1, menu roles and keyboard
  handling). Checked against the code: which data each widget reads, the
  agent selection held in `ActiveAgentProvider` and persisted by
  `AgentSwitcher`, the offline-agent remove button sending `DELETE`, and the
  auth check in `dashboard/page.tsx` are unchanged. The `file:line`
  citations into the changed files moved by one to a dozen lines and were
  re-pointed (the `<ActiveAgentProvider>` citation in widget-data-modes was
  already off before this change). auth-and-config-loading cites only the
  auth-check lines of the dashboard page, which still match. Checked with
  `okf-kit check docs/okf`.
- 2026-10-26T08:27:00Z, auth-and-config-loading and widget-data-modes re-verified and
  re-stamped after "Reset layout" gained a confirmation prompt in
  `src/app/dashboard/page.tsx` (two added lines shift later lines). The
  `router.replace('/login')` citations now read 31-33 and 37-39 and the
  `ActiveAgentProvider` citation reads line 144; nothing else the docs state
  about the page changed. Checked with `okf-kit check docs/okf`.
- 2026-10-26T08:19:19Z, auth-and-config-loading and widget-data-modes re-verified and
  re-stamped after the dashboard layout change. `src/app/dashboard/page.tsx`
  now stores widget layouts per breakpoint through `src/lib/layout-storage.ts`
  and `Navbar.tsx` gets a "Reset layout" button; the cited `router.replace`
  lines (28-32, 36-38) and the Navbar imports (4-7) are unchanged, the
  navbar still mounts `AgentSwitcher`, `AddWidgetMenu`, `UserMenu` and
  `AddAgentModal`, and the `ActiveAgentProvider` citation was re-pointed
  from line 159 to 142. `addWidgetToStorage` now also takes the shown default layout as fallback. Checked with `okf-kit check docs/okf`.
- 2026-10-25T08:26:51Z, release cut 0.3.0 changed only the `version` field on line 3 of
  `package.json` (no line shift). auth-and-config-loading re-verified (the cited
  scripts block still names `node dist/server.js` as the start command) and
  re-stamped. Checked with `okf-kit check docs/okf`.
- 2026-10-23T12:02:22Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified and re-stamped against the sources. Checked
  against the code: `pinnedFetch` now sends the request through undici's
  fetch over an undici Agent whose connector uses the pinned lookup (host
  resolved once, any non-public answer rejects the request, connection only
  to the checked addresses, redirects not followed), with the Agent's
  connect, headers and body limits (10 s, 300 s, 300 s); the proxy routes,
  both log routes and `gatewayJson` cancel the body of a non-OK answer they
  do not read; `undici` is a new dependency in `package.json`, whose
  scripts are unchanged. widget-data-modes: the `pinned-fetch.ts`, memory
  route and stream logs route citations were re-pointed to the current
  lines, and the body cancel is cited in the no-agent section and both log
  route paragraphs (the agent route citations, bracketed path, checked by
  hand). agent-registry-lifecycle and auth-and-config-loading only had
  sources changed; their claims and citations still hold.
- 2026-10-23T11:07:01Z, auth-and-config-loading and widget-data-modes re-verified and
  re-stamped against the sources. Checked against the code: `gatewayFetch`
  requires a `urlSource` ('operator' or 'remote') whenever a `gatewayUrl` is
  passed, the proxy routes and the stream logs route pass 'operator' and the
  agent logs route still uses only `remoteGatewayFetch`; the pinned request is
  bounded in time (10 s connect, 300 s headers, 300 s body idle) and rejects a
  status outside 200-599 instead of hanging. The citations into `gateway.ts`,
  `pinned-fetch.ts` and the stream logs route were re-pointed to the current
  lines; auth-and-config-loading only had its sources changed, its citations
  are unaffected.
- 2026-10-23T10:09:49Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified and re-stamped against the sources. Checked
  against the code: the agent logs route fetches the agent-reported
  `gatewayUrl` only through `remoteGatewayFetch` (full URL rule with a port
  check, no default-gateway exception, host resolved once and the connection
  pinned to the checked addresses, redirects not followed), answers its
  `docker` source with two informational lines without starting `docker`, and
  answers 400 for a `source` outside `openclaw`, `docker` and `system`; the
  stream logs route sends the gateway fetch through `gatewayFetch` and the
  same 400 rule. The citations into `gateway.ts` and both log routes were
  re-pointed to the current lines; the agent route citations (bracketed path,
  which the checker does not resolve) were checked by hand against the file.
- 2026-10-23T05:16:15Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified and re-stamped against the sources. Checked
  against the code: `assertGatewayUrlAllowed` takes an optional
  `{ trustDefault }` (default true, the existing callers unchanged); the agent
  logs route passes `{ trustDefault: false }`, so an agent-reported URL equal
  to the default gateway URL gets the same https, allowlist and private-range
  check as any other (the docs now say so); the `gateway.ts` citations in
  widget-data-modes moved with the new lines, the `route.ts` citations moved by
  the added comment. auth-and-config-loading only had its source changed, its
  citations are unaffected.
- 2026-10-23T05:16:15Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified and re-stamped against the sources. Checked
  against the code: the agent logs route runs `assertGatewayUrlAllowed` on the
  agent-reported `gatewayUrl` before fetching and sets `redirect: 'manual'`
  (a rejected URL ends in the same two "not available" lines), the handshake
  still stores any URL (step 5 of the registry doc now says so); both docker
  log routes answer 400 for an invalid container name and pass `--` before the
  name; the GitHub route reads `GITHUB_TOKEN` and `GITHUB_REPOS` only and
  skips entries that are not `owner/repo`. Citations into the three route
  files were re-pointed to the current lines and the github-prs and Log tail
  sections of widget-data-modes were updated.

- 2026-10-23T05:11:30Z, agent-registry-lifecycle and auth-and-config-loading re-verified and
  re-stamped after the upgrade routing moved out of `server.ts`. Checked
  against the code: the real server has one `upgrade` listener
  (`src/lib/ws-upgrade.ts`, now a source of the registry doc) and Next gets
  a separate never-listening server via `httpServer`, so agent upgrades no
  longer fail after the first HTTP request; other upgrades are destroyed in
  production and replayed on Next's server in development. The `next(...)`
  call citation in the config doc was re-pointed. Other citations into
  `server.ts` (the import of the router shifted the startup-check lines by
  one) were re-pointed.
- 2026-10-23T04:59:17Z, auth-and-config-loading re-verified and re-stamped after the `next` and `@next/env` dependency lines of `package.json` moved from 15.5.27 to 15.5.28. The doc's only `package.json` citation is the `start` script (`package.json:7-9`), which did not move, and its `@next/env` statements describe behaviour, not a version; claims unchanged.
- 2026-10-21T06:28:30Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified and re-stamped against the sources. Checked
  against the code: the shared invalid-token branch of
  `src/lib/agent-ws-handler.ts` closes with 1008, also after a failed token
  re-read; a throwing token-store read at the first lookup answers
  `auth_error` and closes with 1008 with a warning that carries only the
  error message (added to step 4 of the registry doc); the Docker proxy
  route passes `--type container` to its one batched `docker inspect`. All
  citations into `agent-ws-handler.ts` were re-pointed to the current lines
  (the token check, the `auth_ok` reply, the snapshot and ping handling, the
  `lastUsedAt` stamp, the close handler); the claims of the other two docs
  are unaffected. `okf-kit check docs/okf`: no citation or future-dated
  findings.
- 2026-10-16T12:38:23Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-stamped after the Tailwind CSS 4 migration: their
  sources `src/app/dashboard/page.tsx` and `src/components/Nav/AgentSwitcher.tsx`
  changed only in class names, and `package.json` only in its Tailwind
  devDependencies; the claims are unaffected.
- 2026-10-15T11:55:56Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified after the review follow-ups. The handshake
  now fails closed when the fresh token re-read throws (only the write stays
  best effort), and the GitHub route remembers a passed commit per
  repository for five minutes instead of indefinitely. Citations in
  `agent-ws-handler.ts` and the GitHub route re-pointed.
  `okf-kit check --require-anchors docs/okf`: no citation findings.

- 2026-10-15T11:45:42Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified after the handshake and proxy follow-ups.
  agent-registry-lifecycle: the `lastUsedAt` stamp re-reads `tokens.json` and
  patches only the matched id, and a token revoked during the bcrypt
  comparison is rejected; citations in `agent-ws-handler.ts` re-pointed.
  auth-and-config-loading: the `$`-expansion caveat for a key set in both the
  process environment and a file. widget-data-modes: GitHub route citations
  re-pointed. `okf-kit check --require-anchors docs/okf`: clean.

- 2026-10-15T11:34:28Z, agent-registry-lifecycle, auth-and-config-loading and
  widget-data-modes re-verified against the sources after the UI-action and
  env-loading change. agent-registry-lifecycle: `DELETE /api/agents/<id>`
  now exists and `lastUsedAt` is written on a persisted-token handshake, the
  session-log route is gone. auth-and-config-loading: `server.ts` loads the
  `.env` files first through `src/lib/env-bootstrap.ts`, so the old
  "invisible to the server graph" cases no longer apply, and `plaintext` is
  gone from `PasswordConfig`. widget-data-modes: `InstanceSwitcher` is
  removed, the health and GitHub widgets read `SERVICE_HEALTH_URLS` and
  `GITHUB_REPOS`. `okf-kit check --require-anchors docs/okf`: clean.

- 2026-10-12T10:03:11Z, widget-data-modes re-verified against
  `src/app/api/proxy/docker/route.ts` after the proxy started reading the
  restart count from a batched `docker inspect`: the `docker` row names the
  inspect call and the route citation moved to the `docker ps -a` lines.
  `okf-kit check --json --require-anchors docs/okf`: clean.

- 2026-10-11T16:21:35Z, auth-and-config-loading and widget-data-modes
  re-verified against the sources at master `09eafa7`.
  auth-and-config-loading: the unauthenticated `/api/auth` handlers are
  listed, the dashboard redirect cites both branches,
  `ALLOWED_GATEWAY_HOSTS` joins the route-graph-only variables, the data
  files are described as created with `0o600`, and the change-password
  `admin` fallback is limited to development. widget-data-modes: the
  further per-widget sources are named, the default-gateway sentence is
  limited to the widgets' requests, and the navbar component list includes
  `AddAgentModal`. `okf-kit check --json --require-anchors docs/okf`: clean.

- 2026-10-11T15:44:16Z, widget-data-modes and agent-registry-lifecycle
  re-verified against the sources at master `09eafa7`. widget-data-modes:
  the no-agent section now says `InstanceSwitcher` is not rendered
  (sources gain `InstanceSwitcher.tsx` and `Navbar.tsx`).
  `okf-kit check --json --require-anchors docs/okf`: clean.
- 2026-10-11T12:42:59Z, bundle introduced with three docs verified
  against the sources at master `09eafa7`: agent-registry-lifecycle
  (invariant), auth-and-config-loading (module), widget-data-modes
  (module). No benchmark doc. Warn-only CI added in
  `.github/workflows/okf-staleness.yml` (okf-kit 0.16.0 pin, `master`
  branch filter). `okf-kit check --json --require-anchors docs/okf`: clean.
  Citations the tool does not parse (`.tsx`, `Dockerfile`, bracketed route
  paths) were checked by hand for file, range, and an anchor that occurs
  once, on the range's last content line.
