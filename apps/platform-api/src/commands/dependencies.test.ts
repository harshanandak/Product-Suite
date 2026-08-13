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
