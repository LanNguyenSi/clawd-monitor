import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ agentId: string }>
}

/** Remove an offline agent from the registry (used by the navbar agent switcher). */
export async function DELETE(req: NextRequest, { params }: Props) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { agentId } = await params
  const result = registry.remove(agentId)
  if (result === 'not_found') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (result === 'online') {
    return NextResponse.json({ error: 'Agent is online; only offline agents can be removed' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
