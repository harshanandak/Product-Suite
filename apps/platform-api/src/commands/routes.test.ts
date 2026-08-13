import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import type { CommandRegistryDependencies } from './registry'
import { createCommandsRoutes } from './routes'
import type { AuthedEnv } from '../middleware/clerk-auth'

function dependencies(): CommandRegistryDependencies {
  return {
    resolveAuthority: vi.fn(async () => ({ tenantId: 'tenant-1', userId: 'user-1', capabilities: ['edit'] as const })),
    findReplay: vi.fn(async () => null),
    loadWorkItem: vi.fn(async () => ({ id: 'item-1', tenant_id: 'tenant-1', version: 1 })),
    createWorkItem: vi.fn(async () => ({ id: 'item-1', version: 1 })),
    updateWorkItem: vi.fn(async () => ({ id: 'item-1', version: 2 })),
    loadProposal: vi.fn(async () => null),
    applyProposal: vi.fn(async () => ({ id: 'item-1', version: 2 })),
  }
}

function app(deps = dependencies()) {
  const api = new Hono<AuthedEnv>()
  api.use('*', async (c, next) => {
    c.set('claims', { provider: 'clerk', subject: 'subject-1' })
    await next()
  })
  api.route('/api/v1/commands', createCommandsRoutes(() => deps))
  return api
}

const create = {
  version: 1,
  command: 'work-item.create',
  idempotencyKey: 'key-1',
  input: { title: 'Governed' },
}

describe('/api/v1 command routes', () => {
  it('returns a versioned preview without accepting authority from the body', async () => {
    const response = await app().request('/api/v1/commands/work-item.create/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-1' },
      body: JSON.stringify(create),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ command: 'work-item.create', capability: { required: 'edit', granted: true } })
  })

  it.each([
    { tenantId: 'forged' },
    { actor: { id: 'forged' } },
    { role: 'owner' },
    { approval: { state: 'approved' } },
    { input: { title: 'Governed', onBehalfOf: 'agent-1' } },
    { input: { title: 'Governed', delegation: ['agent-1'] } },
  ])('rejects body-derived authority %#', async (forgery) => {
    const response = await app().request('/api/v1/commands/work-item.create/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-1' },
      body: JSON.stringify({ ...create, ...forgery }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'COMMAND_ENVELOPE_INVALID', requestId: 'req-1' } })
  })

  it('rejects a command path/envelope mismatch', async () => {
    const response = await app().request('/api/v1/commands/work-item.update/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1' },
      body: JSON.stringify(create),
    })
    expect(response.status).toBe(400)
  })
})
