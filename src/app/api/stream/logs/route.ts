import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { gatewayFetch, GatewayUrlError } from '@/lib/gateway'
import { isLogSource, isValidContainerName, type LogSource } from '@/lib/input-validators'
import { spawn } from 'child_process'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const requestedSource = searchParams.get('source') ?? 'openclaw'
  if (!isLogSource(requestedSource)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
  }
  const source: LogSource = requestedSource
  const container = searchParams.get('container') ?? ''

  // Reject before the stream starts: the name becomes an argument of
  // `docker logs`, and an invalid one must not reach spawn.
  if (source === 'docker' && container && !isValidContainerName(container)) {
    return NextResponse.json({ error: 'Invalid container name' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(line: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
        } catch {
          // connection closed
        }
      }

      let child: ReturnType<typeof spawn> | null = null

      if (source === 'docker') {
        if (!container) { send('[error] no container selected'); return }
        const name = container
        child = spawn('docker', ['logs', '--tail', '50', '--follow', '--', name], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout?.on('data', (d: Buffer) => {
          d.toString().split('\n').filter(Boolean).forEach(send)
        })
        child.stderr?.on('data', (d: Buffer) => {
          d.toString().split('\n').filter(Boolean).forEach(send)
        })
        child.on('error', () => send('[error] docker not available'))

      } else if (source === 'system') {
        // Try journalctl first, fall back to syslog
        child = spawn('journalctl', ['-f', '-n', '50', '--no-pager', '--output=short'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let journalFailed = false
        child.stdout?.on('data', (d: Buffer) => {
          d.toString().split('\n').filter(Boolean).forEach(send)
        })
        child.stderr?.on('data', () => {
          if (journalFailed) return
          journalFailed = true
          child?.kill()
          // journalctl not available, try tail
          child = spawn('tail', ['-f', '-n', '50', '/var/log/syslog'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          child.stdout?.on('data', (d: Buffer) => {
            d.toString().split('\n').filter(Boolean).forEach(send)
          })
          child.on('error', () => send('[error] no system log available'))
        })
        child.on('error', () => {
          send('[error] no system log available (journalctl not found)')
        })

      } else {
        // openclaw: try Gateway /logs/stream, fall back to journal
        const gatewayUrl = req.headers.get('x-gateway-url') ?? process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL ?? 'http://localhost:9500'
        const token = req.headers.get('x-gateway-token') ?? process.env.DEFAULT_GATEWAY_TOKEN ?? ''

        // Fall back to the local journal for the openclaw process.
        const startJournalFallback = () => {
          child = spawn('journalctl', ['-f', '-n', '50', '--no-pager', '-u', 'openclaw', '--output=short'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          child.stdout?.on('data', (d: Buffer) => {
            d.toString().split('\n').filter(Boolean).forEach(send)
          })
          child.on('error', () => {
            send('[info] Gateway log stream not available, no local log source found')
          })
        }

        // SSRF guard: gatewayUrl can come from the attacker-controlled
        // x-gateway-url header and its body is streamed back to the caller, so
        // gatewayFetch validates it (allowlist with a matching port,
        // private-range guard), resolves its host once and connects to the
        // checked address. The operator default gateway URL is trusted. On
        // rejection, use the local journal instead.
        gatewayFetch('/logs/stream', {
          gatewayUrl,
          urlSource: 'operator',
          token,
          signal: req.signal,
        }).then(async (res) => {
          if (!res.ok || !res.body) {
            // An unread body keeps its connection open until it is collected.
            await res.body?.cancel()
            startJournalFallback()
            return
          }
          // Stream from gateway
          const reader = res.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = new TextDecoder().decode(value)
            text.split('\n').filter(Boolean).forEach(send)
          }
        }).catch((err) => {
          if (err instanceof GatewayUrlError) {
            send(`[error] ${err.message}`)
            startJournalFallback()
          } else {
            send('[info] Connecting to OpenClaw Gateway...')
          }
        })
      }

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 15_000)

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        child?.kill()
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
