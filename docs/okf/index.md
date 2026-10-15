# Knowledge bundle index

Curated OKF knowledge bundle for the clawd-monitor repo. These docs capture
cross-file semantics that no single source file or existing reference doc
states on its own, mostly where the custom server (`server.ts`) and the
Next.js-compiled routes meet. For the feature and configuration reference,
see `docs/` one level up ([ARCHITECTURE.md](../ARCHITECTURE.md),
[configuration.md](../configuration.md),
[AGENT-PROTOCOL.md](../AGENT-PROTOCOL.md), [widgets.md](../widgets.md)) and
the root `README.md`; these docs point to them instead of duplicating them.

## Modules

- [Auth and config loading](auth-and-config-loading.md), admin password
  precedence, `password.json` and `tokens.json`, JWT cookie flags, and which
  how the custom server loads its `.env` files before its modules read the
  environment.
- [Widget data modes](widget-data-modes.md), per widget: the agent-snapshot
  source when an agent is selected, the default-gateway or dashboard-host
  source when none is, and the widgets that ignore the selection.

## Invariants

- [Agent registry lifecycle](agent-registry-lifecycle.md), the WebSocket
  handshake order, tokens not bound to an `agentId`, newest connection wins,
  offline marking by the current socket only, lazy TTL eviction inside
  `getAll()`, and token revocation affecting new connections only.

## Maintenance

- When a file in a doc's `sources:` changes, re-verify that doc's claims
  against the new code, re-point any moved line citation, set its
  `timestamp` to the verification instant, and add an entry to
  [log.md](log.md).
- Check with `okf-kit check --json --require-anchors docs/okf`; CI runs the
  same check warn-only (`.github/workflows/okf-staleness.yml`).
- okf-kit's citation grammar does not parse a cited path with a `.tsx`
  extension, without an extension (`Dockerfile`), or with a bracketed
  segment (`src/app/api/agents/[agentId]/...`). Those citations carry
  anchors like every other one but are not checked by the tool; re-verify
  them by hand when their file changes.
