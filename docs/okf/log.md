# Log

<!-- Add new entries at the top, newest first. -->

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
