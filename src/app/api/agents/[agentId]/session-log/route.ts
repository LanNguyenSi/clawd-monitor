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

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!agent.online) return NextResponse.json({ error: 'Agent offline' }, { status: 503 })
  if (!agent.gatewayUrl) return NextResponse.json({ error: 'Agent has no gatewayUrl' }, { status: 503 })

  const sessionKey = req.nextUrl.searchParams.get('sessionKey')
  const limit = req.nextUrl.searchParams.get('limit') ?? '50'
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey required' }, { status: 400 })

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (agent.gatewayToken) headers['Authorization'] = `Bearer ${agent.gatewayToken}`

  // Try Gateway history endpoint
  const url = `${agent.gatewayUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(sessionKey)}/history?limit=${limit}`

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) {
      return NextResponse.json(
        { error: `Gateway returned ${res.status}`, messages: [] },
        { status: res.status === 404 ? 404 : 502 }
      )
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot reach agent gateway: ${err}`, messages: [] },
      { status: 502 }
    )
  }
}
