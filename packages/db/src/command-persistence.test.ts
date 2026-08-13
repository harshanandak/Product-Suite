import { describe, expect, it, vi } from 'vitest'

import {
  CommandPersistenceError,
  canonicalCommandRequestHash,
  commitCommandTransaction,
  findCommandReplay,
} from './command-persistence'

const scope = {
  tenantId: 'tenant-1',
  actorType: 'human' as const,
  actorId: 'user-1',
  command: 'work-item.update',
  idempotencyKey: 'key-1',
}

function client(replay: unknown[] = []) {
  const tagged = vi.fn(async () => replay)
  const query = vi.fn((text: string, params: unknown[]) => ({ text, params }))
  const transaction = vi.fn(async (queries: unknown[]) => queries.map((query) => [query]))
  Object.assign(tagged, { query, transaction })
  return { sql: tagged, query, transaction }
}

describe('command persistence', () => {
  it('hashes canonical input independently of object key order', () => {
    expect(canonicalCommandRequestHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalCommandRequestHash({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })

  it('returns the original terminal result for the same key and input', async () => {
    const requestHash = canonicalCommandRequestHash({ title: 'same' })
    const { sql } = client([{ request_hash: requestHash, response: { ok: true }, resource_version: 2 }])
    await expect(findCommandReplay(sql as never, { ...scope, requestHash })).resolves.toEqual({
      response: { ok: true },
      resourceVersion: 2,
    })
  })

  it('rejects a reused key with changed input', async () => {
    const { sql } = client([{ request_hash: 'different', response: { ok: true }, resource_version: 2 }])
    await expect(findCommandReplay(sql as never, { ...scope, requestHash: 'current' })).rejects.toEqual(
      new CommandPersistenceError('COMMAND_IDEMPOTENCY_CONFLICT'),
    )
  })

  it('commits the domain write, idempotency result, and audit event in one transaction', async () => {
    const { sql, query, transaction } = client()
    const domainQuery = { text: 'update work_items ... where version = $1 returning *' }
    await commitCommandTransaction(sql as never, [domainQuery], {
      ...scope,
      requestHash: 'hash-1',
      requestId: 'req-1',
      response: { ok: true },
      resourceVersion: 2,
      capability: 'edit',
      approval: { state: 'not_required' },
      targetType: 'work_item',
      targetId: 'item-1',
      before: { version: 1 },
      after: { version: 2 },
    })
    expect(query).toHaveBeenCalledTimes(2)
    expect(transaction).toHaveBeenCalledOnce()
    expect(transaction.mock.calls[0]?.[0]).toEqual([
      domainQuery,
      query.mock.results[0]?.value,
      query.mock.results[1]?.value,
    ])
  })

  it('does not fall back to partial writes when the transaction rejects', async () => {
    const { sql, transaction } = client()
    transaction.mockRejectedValueOnce(new Error('audit insert failed'))
    await expect(
      commitCommandTransaction(sql as never, [{ text: 'domain write' }], {
        ...scope,
        requestHash: 'hash-1',
        requestId: 'req-1',
        response: { ok: true },
        resourceVersion: 2,
        capability: 'edit',
        approval: { state: 'not_required' },
        targetType: 'work_item',
        targetId: 'item-1',
        before: null,
        after: { version: 2 },
      }),
    ).rejects.toThrow('audit insert failed')
    expect(transaction).toHaveBeenCalledOnce()
  })
})
