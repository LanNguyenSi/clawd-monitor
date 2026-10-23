import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'
import { remoteGatewayFetch } from '@/lib/gateway'
import { isLogSource } from '@/lib/input-validators'
import { spawn } from 'child_process'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ agentId: string }> }

export async function GET(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agentId } = await params
  const agent = registry.agents.get(agentId)

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!agent.online) return NextResponse.json({ error: 'Agent offline' }, { status: 503 })

  // The source ends up in the URL of the agent's gateway, so only the known
  // values are accepted.
  const source = req.nextUrl.searchParams.get('source') ?? 'openclaw'
  if (!isLogSource(source)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(line: string) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`)) }
        catch { /* connection closed */ }
      }

      let child: ReturnType<typeof spawn> | null = null

      const abort = () => {
        try { child?.kill() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
      }

      req.signal.addEventListener('abort', abort)

      if (source === 'docker') {
        // `docker logs` would read this server's containers, not the agent's.
        // Container logs of an agent are not available through this route, and
        // the server never starts docker for a request that names an agent.
        send('[info] Docker logs are not available for agents.')
        send('[info] Clear the agent selection to tail containers on the clawd-monitor host.')

      } else if (source === 'system') {
        // Remote agent: system logs are on the agent host, not on this server
        if (agent.gatewayUrl) {
          send('[info] System log streaming not available for remote agents.')
          send('[info] Use SSH or the agent host directly to view system logs.')
        } else {
          child = spawn('journalctl', ['-f', '-n', '50', '--no-pager', '--output=short'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
          child.stderr?.on('data', () => { /* journalctl prints to stderr on failure */ })
          child.on('error', () => {
            child = spawn('tail', ['-f', '-n', '50', '/var/log/syslog'], { stdio: ['ignore', 'pipe', 'pipe'] })
            child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
            child.on('error', () => send('[error] no system log available'))
          })
        }

      } else {
        // openclaw: try gateway /logs/stream, then fall back to the "not available" lines
        // The gateway URL is whatever the agent reported at its handshake, so
        // remoteGatewayFetch checks it, at its only consumer, with the same
        // rule as the proxy routes (https, ALLOWED_GATEWAY_HOSTS with a
        // matching port, no private range), resolves its host once and
        // connects to the checked address. The operator's default gateway URL
        // gets no exception: an agent that reports it must not make the server
        // fetch that gateway with the agent's token. The handshake itself
        // accepts any URL because the documented agent protocol sends a
        // loopback one. A rejected URL fails closed into the "not available"
        // lines below.
        if (agent.gatewayUrl) {
          const headers: Record<string, string> = {}
          if (agent.gatewayToken) headers['Authorization'] = `Bearer ${agent.gatewayToken}`

          remoteGatewayFetch(agent.gatewayUrl, `/logs/stream?source=${source}`, {
            headers,
            signal: req.signal,
          }).then(async (res) => {
            if (!res.ok || !res.body) {
              // Gateway doesn't have /logs/stream, so show the info lines.
              // An unread body keeps its connection open until it is collected.
              await res.body?.cancel()
              spawnJournalctl()
              return
            }
            const reader = res.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              new TextDecoder().decode(value).split('\n').filter(Boolean).forEach(send)
            }
          }).catch(() => spawnJournalctl())
        } else {
          spawnJournalctl()
        }

        function spawnJournalctl() {
          // Remote agent: gateway is on a different host, can't stream logs directly.
          // Send informative message immediately so widget doesn't hang on "Connecting…"
          send('[info] Log streaming not available for remote agents.')
          send('[info] The agent runs on a different host — logs cannot be proxied via this server.')
        }
      }
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
