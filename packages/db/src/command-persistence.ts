import { createHash } from 'node:crypto'

export type CommandActorType = 'human' | 'agent' | 'system' | 'import'

interface CommandSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
  query(text: string, params: unknown[]): unknown
  transaction(queries: unknown[]): Promise<unknown[][]>
}

interface CommandScope {
  tenantId: string
  actorType: CommandActorType
  actorId: string
  command: string
  idempotencyKey: string
}

interface ReplayScope extends CommandScope {
  requestHash: string
}

export interface CommandTransactionOutcome extends ReplayScope {
  requestId: string
  response: unknown
  resourceVersion: number
  onBehalfOf?: string
  capability: string
  approval: Record<string, unknown>
  targetType: string
  targetId: string | null
  before: unknown
  after: unknown
}

export class CommandPersistenceError extends Error {
  constructor(public readonly code: 'COMMAND_IDEMPOTENCY_CONFLICT') {
    super(code)
    this.name = 'CommandPersistenceError'
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

export function canonicalCommandRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex')
}

export async function findCommandReplay(
  sql: CommandSql,
  scope: ReplayScope,
): Promise<{ response: unknown; resourceVersion: number } | null> {
  const rows = (await sql`
    select request_hash, response, resource_version
    from command_idempotency
    where tenant_id = ${scope.tenantId}
      and actor_type = ${scope.actorType}::actor_type
      and actor_id = ${scope.actorId}
      and command = ${scope.command}
      and idempotency_key = ${scope.idempotencyKey}
    limit 1
  `) as Array<{ request_hash: string; response: unknown; resource_version: number }>
  const row = rows[0]
  if (!row) return null
  if (row.request_hash !== scope.requestHash) {
    throw new CommandPersistenceError('COMMAND_IDEMPOTENCY_CONFLICT')
  }
  return { response: row.response, resourceVersion: row.resource_version }
}

export async function commitCommandTransaction(
  sql: CommandSql,
  domainQueries: readonly unknown[],
  outcome: CommandTransactionOutcome,
): Promise<void> {
  if (domainQueries.length === 0) throw new Error('COMMAND_DOMAIN_WRITE_REQUIRED')
  await sql.transaction([...domainQueries, ...buildCommandPersistenceQueries(sql, outcome)])
}

export function buildCommandPersistenceQueries(
  sql: Pick<CommandSql, 'query'>,
  outcome: CommandTransactionOutcome,
): unknown[] {
  const idempotencyId = crypto.randomUUID()
  const auditId = crypto.randomUUID()
  const idempotency = sql.query(
    `insert into command_idempotency
      (id, tenant_id, actor_type, actor_id, command, idempotency_key, request_hash,
       request_id, response, resource_version)
     values ($1, $2, $3::actor_type, $4, $5, $6, $7, $8, $9::jsonb, $10)
     returning id`,
    [
      idempotencyId,
      outcome.tenantId,
      outcome.actorType,
      outcome.actorId,
      outcome.command,
      outcome.idempotencyKey,
      outcome.requestHash,
      outcome.requestId,
      JSON.stringify(outcome.response),
      outcome.resourceVersion,
    ],
  )
  const audit = sql.query(
    `insert into command_audit_events
      (id, tenant_id, idempotency_id, request_id, command, actor_type, actor_id,
       on_behalf_of, capability, approval, target_type, target_id, before, after)
     values ($1, $2, $3, $4, $5, $6::actor_type, $7, $8, $9, $10::jsonb, $11,
       $12::uuid, $13::jsonb, $14::jsonb)
     returning id`,
    [
      auditId,
      outcome.tenantId,
      idempotencyId,
      outcome.requestId,
      outcome.command,
      outcome.actorType,
      outcome.actorId,
      outcome.onBehalfOf ?? null,
      outcome.capability,
      JSON.stringify(outcome.approval),
      outcome.targetType,
      outcome.targetId,
      outcome.before === null ? null : JSON.stringify(outcome.before),
      JSON.stringify(outcome.after),
    ],
  )
  return [idempotency, audit]
}
