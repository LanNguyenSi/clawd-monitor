# Log

<!-- Add new entries at the top, newest first. -->

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
