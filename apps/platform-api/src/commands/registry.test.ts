import { describe, expect, it, vi } from 'vitest'

import {
  CommandRegistryError,
  createCommandRegistry,
  previewHash,
  type CommandRegistryDependencies,
} from './registry'

const base = {
  version: 1 as const,
  command: 'work-item.update' as const,
  idempotencyKey: 'key-1',
  expectedVersion: 3,
  input: { workItemId: 'item-1', patch: { title: 'Governed' } },
}

function dependencies(overrides: Partial<CommandRegistryDependencies> = {}) {
  return {
    resolveAuthority: vi.fn(async () => ({
      tenantId: 'tenant-1',
      userId: 'user-1',
      capabilities: ['read', 'edit'] as const,
    })),
    findReplay: vi.fn(async () => null),
    loadWorkItem: vi.fn(async () => ({ id: 'item-1', tenant_id: 'tenant-1', version: 3, title: 'Old' })),
    createWorkItem: vi.fn(async () => ({ id: 'item-1', version: 1 })),
    updateWorkItem: vi.fn(async () => ({ id: 'item-1', version: 4 })),
    loadProposal: vi.fn(async () => null),
    applyProposal: vi.fn(async () => ({ id: 'item-1', version: 4 })),
    ...overrides,
  } satisfies CommandRegistryDependencies
}

describe('governed command registry', () => {
  it('previews and executes the same normalized direct-human work-item update', async () => {
    const deps = dependencies()
    const registry = createCommandRegistry(deps)
    const preview = await registry.preview({ claims: { provider: 'clerk', subject: 'subject-1' }, tenantId: 'tenant-1', requestId: 'req-1' }, base)
    const result = await registry.execute(
      { claims: { provider: 'clerk', subject: 'subject-1' }, tenantId: 'tenant-1', requestId: 'req-2' },
      { ...base, previewHash: preview.previewHash },
    )
    expect(preview.approval).toEqual({ state: 'not_required' })
    expect(deps.updateWorkItem).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: 'human', id: 'user-1' } }))
    expect(result.resourceVersion).toBe(4)
  })

  it('permits member edit and rejects a known viewer as 403', async () => {
    const member = createCommandRegistry(dependencies())
    await expect(member.preview({ claims: { provider: 'clerk', subject: 'member' }, tenantId: 'tenant-1', requestId: 'r' }, base)).resolves.toBeDefined()

    const viewer = createCommandRegistry(dependencies({
      resolveAuthority: vi.fn(async () => ({ tenantId: 'tenant-1', userId: 'viewer-1', capabilities: ['read'] as const })),
    }))
    await expect(viewer.preview({ claims: { provider: 'clerk', subject: 'viewer' }, tenantId: 'tenant-1', requestId: 'r' }, base)).rejects.toEqual(
      new CommandRegistryError('COMMAND_CAPABILITY_DENIED', 403),
    )
  })

  it('keeps cross-tenant targets indistinguishable from missing at 404', async () => {
    const registry = createCommandRegistry(dependencies({ loadWorkItem: vi.fn(async () => null) }))
    await expect(registry.preview({ claims: { provider: 'clerk', subject: 'subject' }, tenantId: 'tenant-1', requestId: 'r' }, base)).rejects.toEqual(
      new CommandRegistryError('COMMAND_NOT_FOUND', 404),
    )
  })

  it.each([
    ['stale version', { ...base, expectedVersion: 2 }, 'COMMAND_VERSION_CONFLICT'],
    ['preview drift', { ...base, previewHash: 'sha256:stale' }, 'COMMAND_PREVIEW_DRIFT'],
  ])('rejects %s with 409', async (_label, request, code) => {
    const registry = createCommandRegistry(dependencies())
    const action = 'previewHash' in request
      ? registry.execute({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r' }, request)
      : registry.preview({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r' }, request)
    await expect(action).rejects.toEqual(new CommandRegistryError(code, 409))
  })

  it('returns same-input replay and rejects changed-input idempotency at 409', async () => {
    const terminal = { resourceVersion: 4, data: { id: 'item-1' } }
    const same = createCommandRegistry(dependencies({ findReplay: vi.fn(async () => ({ sameInput: true, result: terminal })) }))
    const normalized = { ...base, previewHash: previewHash(base) }
    await expect(same.execute({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r' }, normalized)).resolves.toEqual(terminal)

    const changed = createCommandRegistry(dependencies({ findReplay: vi.fn(async () => ({ sameInput: false, result: terminal })) }))
    await expect(changed.execute({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r' }, normalized)).rejects.toEqual(
      new CommandRegistryError('COMMAND_IDEMPOTENCY_CONFLICT', 409),
    )
  })

  it('derives proposal command, stored approval, snapshot and proposing-agent provenance server-side', async () => {
    const proposal = {
      id: 'proposal-1', tenant_id: 'tenant-1', status: 'accepted', target_type: 'work_item',
      operation: 'update', target_id: 'item-1', target_version: 3,
      target_snapshot: { title: 'Old' }, payload: { title: 'New' }, run_id: 'agent-run-1',
    }
    const deps = dependencies({ loadProposal: vi.fn(async () => proposal) })
    const registry = createCommandRegistry(deps)
    const request = { version: 1 as const, command: 'proposal.apply' as const, idempotencyKey: 'k', input: { proposalId: 'proposal-1' } }
    const preview = await registry.preview({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r' }, request)
    await registry.execute({ claims: { provider: 'clerk', subject: 's' }, tenantId: 'tenant-1', requestId: 'r2' }, { ...request, previewHash: preview.previewHash })
    expect(preview.approval).toEqual({ state: 'approved', source: 'stored_proposal' })
    expect(deps.applyProposal).toHaveBeenCalledWith(expect.objectContaining({
      command: 'work-item.update', expectedVersion: 3, snapshot: { title: 'Old' },
      actor: { type: 'human', id: 'user-1' }, onBehalfOf: { type: 'agent', id: 'agent-run-1' },
    }))
  })
})
