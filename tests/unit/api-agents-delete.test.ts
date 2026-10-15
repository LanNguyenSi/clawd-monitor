/**
 * Unit tests for DELETE /api/agents/[agentId] (remove an offline agent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type WebSocket from 'ws'

vi.mock('@/lib/auth', () => ({ isAuthenticated: vi.fn() }))

import { isAuthenticated } from '@/lib/auth'
import { registry } from '@/lib/agent-registry'
import { DELETE } from '@/app/api/agents/[agentId]/route'

const authMock = vi.mocked(isAuthenticated)

function call(agentId: string) {
  return DELETE(
    new NextRequest(`http://localhost/api/agents/${agentId}`, { method: 'DELETE' }),
    { params: Promise.resolve({ agentId }) },
  )
}

function register(agentId: string) {
  registry.register({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, {
    agentId, name: agentId, version: '1', token: 't',
  })
}

describe('DELETE /api/agents/[agentId]', () => {
  beforeEach(() => {
    registry.agents.clear()
    authMock.mockReturnValue(true)
  })

  it('returns 401 without auth and keeps the agent', async () => {
    authMock.mockReturnValue(false)
    register('a1')
    registry.disconnect('a1')
    expect((await call('a1')).status).toBe(401)
    expect(registry.getAgent('a1')).not.toBeNull()
  })

  it('removes an offline agent for good (200, gone from getAll)', async () => {
    register('a1')
    registry.disconnect('a1')
    const res = await call('a1')
    expect(res.status).toBe(200)
    expect(registry.getAll().map((a) => a.agentId)).not.toContain('a1')
  })

  it('returns 409 for an online agent and keeps it', async () => {
    register('a2')
    expect((await call('a2')).status).toBe(409)
    expect(registry.getAgent('a2')).not.toBeNull()
  })

  it('returns 404 for an unknown agent', async () => {
    expect((await call('missing')).status).toBe(404)
  })
})
