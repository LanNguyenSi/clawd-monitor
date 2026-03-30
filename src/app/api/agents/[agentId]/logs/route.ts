import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'
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

  const source = req.nextUrl.searchParams.get('source') ?? 'openclaw'
  const container = req.nextUrl.searchParams.get('container') ?? ''

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
        const name = container || 'openclaw'
        child = spawn('docker', ['logs', '--tail', '50', '--follow', name], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
        child.stderr?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
        child.on('error', () => send('[error] docker not available'))

      } else if (source === 'system') {
        child = spawn('journalctl', ['-f', '-n', '50', '--no-pager', '--output=short'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
        child.on('error', () => {
          child = spawn('tail', ['-f', '-n', '50', '/var/log/syslog'], { stdio: ['ignore', 'pipe', 'pipe'] })
          child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
          child.on('error', () => send('[error] no system log available'))
        })

      } else {
        // openclaw: try gateway /logs/stream, then fall back to journalctl on agent's host
        if (agent.gatewayUrl) {
          const headers: Record<string, string> = {}
          if (agent.gatewayToken) headers['Authorization'] = `Bearer ${agent.gatewayToken}`

          fetch(`${agent.gatewayUrl.replace(/\/$/, '')}/logs/stream?source=${source}`, {
            headers,
            signal: req.signal,
          }).then(async (res) => {
            if (!res.ok || !res.body) {
              // Gateway doesn't have /logs/stream — fall back to journalctl (server-side)
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
          send('[info] Wave 9: log push via WebSocket will enable real-time remote logs.')
        }

        function tryDockerLogs() {
          // Fallback: try docker logs for clawd-monitor-agent container
          child = spawn('docker', ['logs', '--tail', '100', '--follow', 'clawd-monitor-agent'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
          child.stderr?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
          child.on('error', () => {
            // Last resort: tail /var/log/syslog
            child = spawn('tail', ['-f', '-n', '100', '/var/log/syslog'], { stdio: ['ignore', 'pipe', 'pipe'] })
            child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(send))
            child.on('error', () => send('[info] No log source available on this host'))
          })
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
