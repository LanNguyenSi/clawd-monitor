---
type: module
title: Widget data modes, agent snapshot vs default gateway vs dashboard host
description: For each dashboard widget, where its data comes from when an agent is selected (the agent's last WebSocket snapshot) and when none is (the default gateway or the dashboard host itself), which widgets ignore the selection, and how the selection is held.
tags: [widgets, dashboard, agents, data-sources]
timestamp: 2026-10-12T10:03:00Z
sources:
  - src/lib/widgets.ts
  - src/lib/active-agent.tsx
  - src/lib/schemas.ts
  - src/lib/gateway.ts
  - src/app/dashboard/page.tsx
  - src/components/Nav/AgentSwitcher.tsx
  - src/components/Nav/InstanceSwitcher.tsx
  - src/components/Nav/Navbar.tsx
  - src/components/widgets/AgentListWidget.tsx
  - src/components/widgets/AgentStatusWidget.tsx
  - src/components/widgets/AlertHistoryWidget.tsx
  - src/components/widgets/CronWidget.tsx
  - src/components/widgets/DockerWidget.tsx
  - src/components/widgets/GitHubPRWidget.tsx
  - src/components/widgets/HeartbeatWidget.tsx
  - src/components/widgets/LogTailWidget.tsx
  - src/components/widgets/MemoryWidget.tsx
  - src/components/widgets/MetricsWidget.tsx
  - src/components/widgets/ServiceHealthWidget.tsx
  - src/components/widgets/SessionLogWidget.tsx
  - src/app/api/agents/[agentId]/snapshot/route.ts
  - src/app/api/agents/[agentId]/logs/route.ts
  - src/app/api/proxy/sessions/route.ts
  - src/app/api/proxy/cron/route.ts
  - src/app/api/proxy/heartbeat/route.ts
  - src/app/api/proxy/memory/route.ts
  - src/app/api/proxy/docker/route.ts
  - src/app/api/proxy/health/route.ts
  - src/app/api/proxy/github/route.ts
  - src/app/api/proxy/alert-history/route.ts
  - src/app/api/containers/route.ts
  - src/app/api/stream/metrics/route.ts
  - src/app/api/stream/logs/route.ts
---

# Widget data modes, agent snapshot vs default gateway vs dashboard host

What each widget displays is described for humans in
[widgets.md](../widgets.md). This doc records where each widget's data
comes from, which depends on whether an agent is selected, and which
machine that source runs on.

## Responsibility

- The widget components under `src/components/widgets/` choose their data
  source from the selected agent; the routes they call decide which machine
  answers. The widget list itself is `WIDGET_REGISTRY`
  (`src/lib/widgets.ts:4-15#"SessionLogWidget"`).
- The main sources are the selected agent's last snapshot, held in the
  [agent registry](agent-registry-lifecycle.md); the default gateway; and
  the dashboard host, meaning the machine or container the dashboard
  process runs in. A few widgets use further sources, listed per widget
  below: the GitHub API (`github-prs`) and a fixed list of service URLs
  (`service-health`).

## How the selection is held

`ActiveAgentProvider` keeps `activeAgentId` in React state, initially
`null` (`src/lib/active-agent.tsx:17#"useState<string | null>(null)"`); the
dashboard page wraps its grid in it
(`src/app/dashboard/page.tsx:159#"<ActiveAgentProvider>"`). Two components
set it:

- `AgentSwitcher` in the navbar restores the last choice from the
  `localStorage` key `clawd-monitor:activeAgentId` on mount and writes every
  change back
  (`src/components/Nav/AgentSwitcher.tsx:47-49#"if (saved) setActiveAgentId(saved)"`,
  `src/components/Nav/AgentSwitcher.tsx:53-55#"localStorage.removeItem(STORAGE_KEY)"`).
- `AgentListWidget` toggles the selection on click without persisting it
  (`src/components/widgets/AgentListWidget.tsx:67#"setActiveAgentId(isActive ? null : agent.agentId)"`).

## Agent mode: the snapshot

With an agent selected, the snapshot widgets poll
`GET /api/agents/<id>/snapshot`, which returns the registry's
`lastSnapshot`, `lastSnapshotAt` and `online`
(`src/app/api/agents/[agentId]/snapshot/route.ts:20-23#"online: agent.online"`).
The data is only as fresh as the agent's last `snapshot` message; these
widgets send nothing to the agent. The snapshot fields are fixed
by `agentSnapshotSchema`: `sessions`, `cronJobs`, `metrics`, `memoryFiles`
and `containers`
(`src/lib/schemas.ts:8-22#"containers: z.array(z.unknown()).default([])"`).
When the entry is offline, these widgets show an "Agent offline" state with
the last-seen time instead of the stale data, for example
`src/components/widgets/DockerWidget.tsx:41#"!snapshotData.online"`; the
heartbeat widget shows `SILENT`
(`src/components/widgets/HeartbeatWidget.tsx:56#"online ? 'OK' : 'SILENT'"`).

## No-agent mode: default gateway or dashboard host

Without a selection, each widget calls its own route. Routes that use
`gatewayFetch()` without an `x-gateway-url` header go to the default
gateway URL and token
(`src/lib/gateway.ts:116#"options.gatewayUrl ?? DEFAULT_GATEWAY_URL"`,
`src/lib/gateway.ts:120#"options.token ?? DEFAULT_GATEWAY_TOKEN"`). No
widget sets that header, so the widgets' requests to these routes always
reach the default gateway.
`src/lib/instance.ts` and the `InstanceSwitcher` component that uses it
(`src/components/Nav/InstanceSwitcher.tsx:11#"export function InstanceSwitcher"`)
still exist, but no component imports or renders the switcher; the navbar
mounts `AgentSwitcher`, `AddWidgetMenu`, `UserMenu` and `AddAgentModal`
(`src/components/Nav/Navbar.tsx:4-7#"import { AddAgentModal } from '@/components/AddAgentModal'"`).

## Per widget

| Widget (`id`) | Agent selected | No agent selected |
|---|---|---|
| `agent-status` | snapshot `sessions` | `/api/proxy/sessions`, default gateway `/sessions` |
| `cron` | snapshot `cronJobs` | `/api/proxy/cron`, default gateway `/cron/jobs` |
| `heartbeat` | snapshot `online` and `metrics.uptimeSeconds` | `/api/proxy/heartbeat`, default gateway `/status` |
| `memory` | snapshot `memoryFiles` | `/api/proxy/memory`, default gateway `/workspace/memory`, then files under `CLAWD_DIR` on the dashboard host |
| `docker` | snapshot `containers` | `/api/proxy/docker`, `docker ps -a` plus one batched `docker inspect` for the restart count, on the dashboard host |
| `metrics` | snapshot `metrics`, polled | `/api/stream/metrics` SSE, `/proc/stat` and `/proc/meminfo` read by the dashboard process |
| `log-tail` | `/api/agents/<id>/logs` SSE, see below | `/api/stream/logs` SSE, see below |
| `session-log` | snapshot `sessions[].recentMessages` | nothing, a prompt to select an agent |
| `agent-list` | `/api/agents/list` (ignores the selection, sets it) | same |
| `service-health` | ignores the selection | `/api/proxy/health`, `HEAD` requests from the dashboard host to a fixed service list |
| `github-prs` | ignores the selection | `/api/proxy/github`, GitHub API with `GITHUB_TOKEN` |
| `alert-history` | ignores the selection | `/api/proxy/alert-history`, `CLAWD_DIR/memory/smart-alert-state.json` on the dashboard host |

Evidence for the switch in each component, agent URL first:

- `agent-status`: `src/components/widgets/AgentStatusWidget.tsx:52-53#"'/api/proxy/sessions'"`;
  route `src/app/api/proxy/sessions/route.ts:16#"gatewayFetch('/sessions'"`.
- `cron`: `src/components/widgets/CronWidget.tsx:48-49#"'/api/proxy/cron'"`;
  route `src/app/api/proxy/cron/route.ts:14#"gatewayFetch('/cron/jobs'"`.
- `heartbeat`: `src/components/widgets/HeartbeatWidget.tsx:40-46#"'/api/proxy/heartbeat'"`;
  route `src/app/api/proxy/heartbeat/route.ts:18#"gatewayFetch('/status'"`.
- `memory`: `src/components/widgets/MemoryWidget.tsx:45-46#"/api/proxy/memory?file="`;
  route tries the gateway
  (`src/app/api/proxy/memory/route.ts:36#"/workspace/memory?file="`) and
  falls back to the filesystem
  (`src/app/api/proxy/memory/route.ts:46-48#"FILE_PATHS[file] ?? FILE_PATHS.memory"`).
- `docker`: `src/components/widgets/DockerWidget.tsx:29-30#"'/api/proxy/docker'"`;
  route `src/app/api/proxy/docker/route.ts:56#"docker ps -a"`.
- `metrics`: `src/components/widgets/MetricsWidget.tsx:66-67#"/api/agents/"`
  and `src/components/widgets/MetricsWidget.tsx:94-95#"new EventSource('/api/stream/metrics')"`;
  route `src/app/api/stream/metrics/route.ts:19#"/proc/stat"` and
  `src/app/api/stream/metrics/route.ts:38#"/proc/meminfo"`, sampled every
  2 s (`src/app/api/stream/metrics/route.ts:85-89#"}, 2000)"`).
- `session-log`: `src/components/widgets/SessionLogWidget.tsx:63#"recentMessages"`
  and `src/components/widgets/SessionLogWidget.tsx:70-73#"Select an agent to view session logs"`.
  The widget does not call `GET /api/agents/<id>/session-log`; no
  component under `src/components/` does.
- `agent-list`: `src/components/widgets/AgentListWidget.tsx:36#"'/api/agents/list'"`.
- `service-health`: `src/components/widgets/ServiceHealthWidget.tsx:22#"'/api/proxy/health'"`;
  the list is the constant `DEFAULT_SERVICES`
  (`src/app/api/proxy/health/route.ts:6#"DEFAULT_SERVICES"`), probed with
  `HEAD` (`src/app/api/proxy/health/route.ts:32-33#"method: 'HEAD'"`).
- `github-prs`: `src/components/widgets/GitHubPRWidget.tsx:38#"'/api/proxy/github'"`;
  token and repository list come from `GITHUB_TOKEN` and a default in the
  route unless the request passes `token` and `repos` query parameters
  (`src/app/api/proxy/github/route.ts:45-46#"searchParams.get('repos')"`).
  The widget passes neither.
- `alert-history`: `src/components/widgets/AlertHistoryWidget.tsx:29#"'/api/proxy/alert-history'"`;
  route `src/app/api/proxy/alert-history/route.ts:16#"smart-alert-state.json"`.

## Log tail

`LogTailWidget` opens `/api/agents/<id>/logs` with an agent selected and
`/api/stream/logs` without
(`src/components/widgets/LogTailWidget.tsx:60-62#"/api/stream/logs?"`). Its
`source` selector (`openclaw`, `docker`, `system`) is passed through. The
container drop-down always lists containers on the dashboard host
(`src/components/widgets/LogTailWidget.tsx:38-39#"'/api/containers'"`,
route `src/app/api/containers/route.ts:13-14#"docker ps --format"`).

Without an agent (`/api/stream/logs`):

- `docker`: `docker logs --follow` for the chosen container on the
  dashboard host
  (`src/app/api/stream/logs/route.ts:36#"'logs', '--tail', '50', '--follow', name"`).
- `system`: `journalctl -f` on the dashboard host, then `tail -f
  /var/log/syslog` when journalctl writes to stderr
  (`src/app/api/stream/logs/route.ts:61#"/var/log/syslog"`).
- `openclaw`: the default gateway's `/logs/stream`
  (`src/app/api/stream/logs/route.ts:106#"/logs/stream"`). When the gateway
  answers without an OK streaming body, the route falls back to
  `journalctl -u openclaw` on the dashboard host
  (`src/app/api/stream/logs/route.ts:80#"'-u', 'openclaw'"`); when the
  request itself fails, it sends one informational line and no fallback
  (`src/app/api/stream/logs/route.ts:123-124#"Connecting to OpenClaw Gateway"`).

With an agent (`/api/agents/<id>/logs`), the `docker` and `system`
sources do not read logs from the agent's host:

- `docker`: `docker logs --follow` on the dashboard host, not on the
  agent's host
  (`src/app/api/agents/[agentId]/logs/route.ts:45#"'logs', '--tail', '50', '--follow', name"`).
- `system`: when the agent reported a `gatewayUrl`, two informational lines
  and no log stream
  (`src/app/api/agents/[agentId]/logs/route.ts:54-55#"System log streaming not available"`);
  otherwise `journalctl` on the dashboard host.

## Invariants enforced here

- [Agent registry lifecycle](agent-registry-lifecycle.md), why a selected
  agent's snapshot can be stale, offline, or gone after TTL eviction.
