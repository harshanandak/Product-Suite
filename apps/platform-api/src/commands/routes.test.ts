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
  it('returns a non-retryable envelope error for malformed JSON', async () => {
    const response = await app().request('/api/v1/commands/work-item.create/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-json' },
      body: '{',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'COMMAND_ENVELOPE_INVALID', requestId: 'req-json', retryable: false },
    })
  })

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

  it('returns the canonical terminal result consumed by the SDK', async () => {
    const previewResponse = await app().request('/api/v1/commands/work-item.create/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-preview' },
      body: JSON.stringify(create),
    })
    const preview = await previewResponse.json() as { previewHash: string }
    const response = await app().request('/api/v1/commands/work-item.create/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-execute' },
      body: JSON.stringify({ ...create, previewHash: preview.previewHash }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      version: 1,
      command: 'work-item.create',
      requestId: 'req-execute',
      idempotencyKey: 'key-1',
      previewHash: preview.previewHash,
      resourceVersion: 1,
    })
  })

  it('maps the exact in-transaction CAS assertion to a version conflict', async () => {
    const deps = dependencies()
    deps.updateWorkItem = vi.fn(async () => {
      throw Object.assign(new Error('invalid input syntax for type integer: "COMMAND_VERSION_CONFLICT"'), { code: '22P02' })
    })
    const update = { version: 1, command: 'work-item.update', idempotencyKey: 'key-cas', expectedVersion: 1, input: { workItemId: 'item-1', patch: { title: 'New' } } }
    const previewResponse = await app(deps).request('/api/v1/commands/work-item.update/preview', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1' }, body: JSON.stringify(update),
    })
    const preview = await previewResponse.json() as { previewHash: string }
    const response = await app(deps).request('/api/v1/commands/work-item.update/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1' },
      body: JSON.stringify({ ...update, previewHash: preview.previewHash }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'COMMAND_VERSION_CONFLICT', retryable: true } })
  })

  it('redacts database parameters from unexpected failure logs', async () => {
    const deps = dependencies()
    deps.createWorkItem = vi.fn(async () => { throw Object.assign(new Error('query failed title=Secret tenant=tenant-1'), { code: 'XX000' }) })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const previewResponse = await app(deps).request('/api/v1/commands/work-item.create/preview', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1' }, body: JSON.stringify(create),
    })
    const preview = await previewResponse.json() as { previewHash: string }
    await app(deps).request('/api/v1/commands/work-item.create/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'tenant-1', 'x-request-id': 'req-secret' },
      body: JSON.stringify({ ...create, previewHash: preview.previewHash }),
    })
    expect(error).toHaveBeenCalledWith('[commands] request failed', { requestId: 'req-secret', name: 'Error', code: 'XX000' })
    expect(JSON.stringify(error.mock.calls)).not.toContain('Secret')
    error.mockRestore()
  })
})
