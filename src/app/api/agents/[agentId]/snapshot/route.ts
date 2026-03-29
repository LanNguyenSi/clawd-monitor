import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ agentId: string }>
}

export async function GET(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { agentId } = await params
  const agent = registry.getAgent(agentId)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  return NextResponse.json({
    snapshot: agent.lastSnapshot,
    lastSnapshotAt: agent.lastSnapshotAt,
    online: agent.online,
  })
}
