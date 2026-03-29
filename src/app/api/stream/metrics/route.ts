import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { readFileSync } from 'fs'
import type { SystemMetrics } from '@/types'

export const dynamic = 'force-dynamic'

let prevCpuIdle = 0
let prevCpuTotal = 0

function readCpuPercent(): number {
  try {
    const stat = readFileSync('/proc/stat', 'utf-8')
    const line = stat.split('\n')[0]
    const parts = line.split(/\s+/).slice(1).map(Number)
    // cpu user nice system idle iowait irq softirq ...
    const idle = parts[3] + (parts[4] ?? 0)
    const total = parts.reduce((a, b) => a + b, 0)

    const diffIdle = idle - prevCpuIdle
    const diffTotal = total - prevCpuTotal
    const cpu = diffTotal > 0 ? Math.round((1 - diffIdle / diffTotal) * 100) : 0

    prevCpuIdle = idle
    prevCpuTotal = total
    return Math.max(0, Math.min(100, cpu))
  } catch {
    return 0
  }
}

function readMemory(): { used: number; total: number } {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8')
    const getValue = (key: string): number => {
      const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`))
      return match ? parseInt(match[1]) * 1024 : 0
    }
    const total = getValue('MemTotal')
    const free = getValue('MemFree')
    const buffers = getValue('Buffers')
    const cached = getValue('Cached')
    const used = total - free - buffers - cached
    return { used: Math.max(0, used), total }
  } catch {
    return { used: 0, total: 0 }
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(metrics: SystemMetrics) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(metrics)}\n\n`))
        } catch {
          clearInterval(interval)
        }
      }

      // Initial warmup read (establishes baseline for CPU diff)
      readCpuPercent()

      const interval = setInterval(() => {
        const cpu = readCpuPercent()
        const mem = readMemory()
        send({ cpu, memUsed: mem.used, memTotal: mem.total, timestamp: Date.now() })
      }, 2000)

      // Send first reading after 1s warmup
      setTimeout(() => {
        const cpu = readCpuPercent()
        const mem = readMemory()
        send({ cpu, memUsed: mem.used, memTotal: mem.total, timestamp: Date.now() })
      }, 1000)

      req.signal.addEventListener('abort', () => {
        clearInterval(interval)
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
