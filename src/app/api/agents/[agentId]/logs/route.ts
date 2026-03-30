import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ agentId: string }> }

export async function GET(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agentId } = await params
  const agent = registry.agents.get(agentId)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (!agent.online) {
    return NextResponse.json({ error: 'Agent offline' }, { status: 503 })
  }
  if (!agent.gatewayUrl) {
    return NextResponse.json({ error: 'Agent did not provide gatewayUrl' }, { status: 503 })
  }

  // Build upstream URL: proxy to agent's gateway /logs/stream
  const source = req.nextUrl.searchParams.get('source') ?? 'openclaw'
  const container = req.nextUrl.searchParams.get('container') ?? ''
  const upstreamParams = new URLSearchParams({ source })
  if (container) upstreamParams.set('container', container)

  const upstreamUrl = `${agent.gatewayUrl.replace(/\/$/, '')}/logs/stream?${upstreamParams}`

  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (agent.gatewayToken) headers['Authorization'] = `Bearer ${agent.gatewayToken}`

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { headers, signal: req.signal })
  } catch (err) {
    return NextResponse.json({ error: `Cannot reach agent gateway: ${err}` }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Agent gateway returned ${upstream.status}` }, { status: 502 })
  }

  // Stream SSE back to client
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
