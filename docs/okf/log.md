# Log

<!-- Add new entries at the top, newest first. -->

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
