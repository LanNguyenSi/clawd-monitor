import { NextResponse } from 'next/server'
import { registry } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

export function GET() {
  const agents = registry.getAll()
  return NextResponse.json({
    status: 'ok',
    uptime: process.uptime(),
    agents: {
      total: agents.length,
      online: agents.filter((a) => a.online).length,
    },
  })
}
