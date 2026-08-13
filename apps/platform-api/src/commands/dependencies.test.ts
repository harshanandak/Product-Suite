import { describe, expect, it, vi } from 'vitest'

import { commandRegistryDependencies } from './dependencies'

function sqlClient(rows: unknown[] = []) {
  const sql = vi.fn(async () => rows)
  Object.assign(sql, {
    query: vi.fn((text: string, params: unknown[]) => ({ text, params })),
    transaction: vi.fn(async (queries: unknown[]) => queries.map(() => [])),
  })
  return sql
}

describe('command registry DB dependencies', () => {

  it('ignores a forged source on a direct human create command', async () => {
    const sql = vi.fn()
    sql.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ n: 1 }])
    const query = vi.fn((text: string, params: unknown[]) => ({ text, params }))
    const transaction = vi.fn(async (queries: Array<{ text?: string; params?: unknown[] }>) =>
      queries.map((_entry, index) => index === 0 ? [{ id: 'item-1', version: 1 }] : index === 1 ? [{}] : []))
    Object.assign(sql, { query, transaction })
    const dependencies = commandRegistryDependencies(sql as never)
    await dependencies.createWorkItem({
      invokedCommand: 'work-item.create', replayInput: {} as never, command: 'work-item.create',
      tenantId: 'tenant-1', requestId: 'req-1', idempotencyKey: 'key-1',
      input: { title: 'A', team_id: 'team-1', status_id: 'status-1', source: 'agent' },
      actor: { type: 'human', id: 'user-1' },
      approval: { state: 'not_required' }, previewHash: 'hash',
    })
    const insert = query.mock.calls.find(([text]) => text.startsWith('insert into "work_items"'))
    expect(insert?.[1]).toContain('manual')
    expect(insert?.[1]).not.toContain('agent')
  })

  it('derives meeting source from the tenant-scoped promotion ledger for proposal create', async () => {
    const proposal = {
      id: 'proposal-1', tenant_id: 'tenant-1', status: 'accepted', run_id: 'run-1',
      target_type: 'work_item', operation: 'create', payload: { title: 'A' }, actor_type: 'agent',
    }
    const sql = vi.fn()
    sql.mockResolvedValueOnce([proposal]).mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ n: 1 }])
    const query = vi.fn((text: string, params: unknown[]) =>
      text.startsWith('select id from meeting_promotions') ? Promise.resolve([{ id: 'promotion-1' }]) : { text, params })
    const transaction = vi.fn(async (queries: Array<{ text?: string; params?: unknown[] }>) =>
      queries.map((_entry, index) => index === 0 ? [{ id: 'item-1', version: 1 }] : index === 1 ? [{}] : []))
    Object.assign(sql, { query, transaction })
    const dependencies = commandRegistryDependencies(sql as never)

    await dependencies.applyProposal({
      invokedCommand: 'proposal.apply',
      replayInput: { version: 1, command: 'proposal.apply', idempotencyKey: 'key-1', input: { proposalId: 'proposal-1' }, previewHash: 'hash' },
      command: 'work-item.create', tenantId: 'tenant-1', requestId: 'req-1', idempotencyKey: 'key-1',
      input: { title: 'A', team_id: 'team-1', status_id: 'status-1', proposalId: 'proposal-1', source: 'manual' },
      actor: { type: 'human', id: 'user-1' }, onBehalfOf: { type: 'agent', id: 'run-1' },
      approval: { state: 'approved', source: 'stored_proposal' },
      previewHash: 'hash',
    })

    const insert = query.mock.calls.find(([text]) => text.startsWith('insert into "work_items"'))
    expect(insert?.[1]).toContain('meeting')
    expect(insert?.[1]).not.toContain('manual')
  })
  it('loads work items only through tenant-scoped SQL', async () => {
    const row = { id: 'item-1', tenant_id: 'tenant-1', version: 2 }
    const sql = sqlClient([row])
    const dependencies = commandRegistryDependencies(sql as never)
    await expect(dependencies.loadWorkItem('tenant-1', 'item-1')).resolves.toEqual(row)
    expect(sql).toHaveBeenCalledOnce()
    const call = sql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    const [strings, ...values] = call
    expect(strings.join('?')).toContain('tenant_id = ?')
    expect(values).toContain('tenant-1')
  })

  it('fails closed when proposal apply has no stored accepted proposal', async () => {
    const sql = sqlClient([])
    const dependencies = commandRegistryDependencies(sql as never)
    await expect(dependencies.applyProposal({
      invokedCommand: 'proposal.apply',
      replayInput: {
        version: 1, command: 'proposal.apply', idempotencyKey: 'key-1',
        input: { proposalId: 'proposal-1' }, previewHash: 'sha256:hash',
      },
      command: 'work-item.update',
      tenantId: 'tenant-1',
      requestId: 'req-1',
      idempotencyKey: 'key-1',
      expectedVersion: 2,
      input: { workItemId: 'item-1', patch: { title: 'New' }, proposalId: 'proposal-1' },
      actor: { type: 'human', id: 'user-1' },
      onBehalfOf: { type: 'agent', id: 'run-1' },
      approval: { state: 'approved', source: 'stored_proposal' },
      previewHash: 'sha256:hash',
    })).rejects.toThrow('COMMAND_APPROVAL_REQUIRED')
  })
})
