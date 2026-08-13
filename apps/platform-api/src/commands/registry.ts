import { createHash } from 'node:crypto'

import type { AuthClaims, CommandExecuteRequest, CommandName, CommandRequest, CommandResult } from '@product-suite/contracts'

type Capability = 'read' | 'edit' | 'configure'

export interface RegistryAuthority {
  tenantId: string
  userId: string
  capabilities: readonly Capability[]
}

export interface RegistryWorkItem {
  id: string
  tenant_id: string
  version: number
  [key: string]: unknown
}

export interface RegistryProposal {
  id: string
  tenant_id: string
  status: string
  target_type: string
  operation: string
  target_id: string | null
  target_version: number | null
  target_snapshot: Record<string, unknown> | null
  payload: unknown
  edited_payload?: unknown
  run_id: string | null
}

export interface RegistryReplay {
  sameInput: boolean
  result: RegistryResult
}

export type RegistryResult = CommandResult

export interface RegistryMutation {
  invokedCommand: CommandName
  command: 'work-item.create' | 'work-item.update'
  tenantId: string
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
  input: Record<string, unknown>
  actor: { type: 'human'; id: string }
  onBehalfOf?: { type: 'agent'; id: string }
  approval: { state: 'not_required' } | { state: 'approved'; source: 'stored_proposal' }
  snapshot?: Record<string, unknown>
  previewHash: string
}

export interface CommandRegistryDependencies {
  resolveAuthority(claims: AuthClaims, tenantId: string): Promise<RegistryAuthority | null>
  findReplay(mutation: RegistryMutation): Promise<RegistryReplay | null>
  loadWorkItem(tenantId: string, id: string): Promise<RegistryWorkItem | null>
  createWorkItem(mutation: RegistryMutation): Promise<{ id: string; version: number }>
  updateWorkItem(mutation: RegistryMutation): Promise<{ id: string; version: number }>
  loadProposal(tenantId: string, id: string): Promise<RegistryProposal | null>
  applyProposal(mutation: RegistryMutation): Promise<{ id: string; version: number }>
}

export interface RegistryContext {
  claims: AuthClaims
  tenantId: string
  requestId: string
}

export class CommandRegistryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(code)
    this.name = 'CommandRegistryError'
  }
}

export function commandResult(
  mutation: RegistryMutation,
  result: { id: string; version: number },
): RegistryResult {
  return {
    version: 1,
    command: mutation.invokedCommand,
    requestId: mutation.requestId,
    idempotencyKey: mutation.idempotencyKey,
    actor: mutation.actor,
    ...(mutation.onBehalfOf ? { onBehalfOf: mutation.onBehalfOf } : {}),
    capability: { required: 'edit', granted: true },
    approval: mutation.approval,
    retryable: false,
    previewHash: mutation.previewHash,
    resourceVersion: result.version,
    data: { id: result.id },
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]))
  }
  return value
}

export function previewHash(value: unknown): string {
  const hashInput = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'previewHash'))
    : value
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(hashInput))).digest('hex')}`
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommandRegistryError('COMMAND_ENVELOPE_INVALID', 400)
  }
  return value as Record<string, unknown>
}

async function authority(deps: CommandRegistryDependencies, ctx: RegistryContext) {
  const resolved = await deps.resolveAuthority(ctx.claims, ctx.tenantId)
  if (!resolved || resolved.tenantId !== ctx.tenantId) {
    throw new CommandRegistryError('COMMAND_NOT_FOUND', 404)
  }
  if (!resolved.capabilities.includes('edit')) {
    throw new CommandRegistryError('COMMAND_CAPABILITY_DENIED', 403)
  }
  return resolved
}

async function normalize(
  deps: CommandRegistryDependencies,
  ctx: RegistryContext,
  request: CommandRequest,
): Promise<RegistryMutation> {
  const actor = await authority(deps, ctx)
  const input = record(request.input)
  if (request.command === 'work-item.create') {
    return {
      invokedCommand: request.command,
      command: request.command,
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      idempotencyKey: request.idempotencyKey,
      input,
      actor: { type: 'human', id: actor.userId },
      approval: { state: 'not_required' },
      previewHash: previewHash(request),
    }
  }
  if (request.command === 'work-item.update') {
    const id = input.workItemId
    if (typeof id !== 'string') throw new CommandRegistryError('COMMAND_ENVELOPE_INVALID', 400)
    const item = await deps.loadWorkItem(ctx.tenantId, id)
    if (!item) throw new CommandRegistryError('COMMAND_NOT_FOUND', 404)
    if (request.expectedVersion === undefined || item.version !== request.expectedVersion) {
      throw new CommandRegistryError('COMMAND_VERSION_CONFLICT', 409)
    }
    return {
      invokedCommand: request.command,
      command: request.command,
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      idempotencyKey: request.idempotencyKey,
      expectedVersion: request.expectedVersion,
      input,
      actor: { type: 'human', id: actor.userId },
      approval: { state: 'not_required' },
      previewHash: previewHash(request),
    }
  }

  const proposalId = input.proposalId
  if (typeof proposalId !== 'string') throw new CommandRegistryError('COMMAND_ENVELOPE_INVALID', 400)
  const proposal = await deps.loadProposal(ctx.tenantId, proposalId)
  if (!proposal) throw new CommandRegistryError('COMMAND_NOT_FOUND', 404)
  if (!['accepted', 'accepted_with_edits'].includes(proposal.status) || !proposal.run_id) {
    throw new CommandRegistryError('COMMAND_APPROVAL_REQUIRED', 403)
  }
  const targetCommand = `${proposal.target_type.replace('_', '-')}.${proposal.operation}` as CommandName
  if (!['work-item.create', 'work-item.update'].includes(targetCommand)) {
    throw new CommandRegistryError('COMMAND_ENVELOPE_INVALID', 400)
  }
  const payload = record(proposal.edited_payload ?? proposal.payload)
  const normalizedInput = proposal.operation === 'update'
    ? { workItemId: proposal.target_id, patch: payload, proposalId: proposal.id }
    : { ...payload, proposalId: proposal.id }
  const { previewHash: _previewHash, ...requestWithoutPreview } = request as CommandExecuteRequest
  return {
    invokedCommand: request.command,
    command: targetCommand as RegistryMutation['command'],
    tenantId: proposal.tenant_id,
    requestId: ctx.requestId,
    idempotencyKey: request.idempotencyKey,
    ...(proposal.target_version === null ? {} : { expectedVersion: proposal.target_version }),
    input: normalizedInput,
    actor: { type: 'human', id: actor.userId },
    onBehalfOf: { type: 'agent', id: proposal.run_id },
    approval: { state: 'approved', source: 'stored_proposal' },
    ...(proposal.target_snapshot === null ? {} : { snapshot: proposal.target_snapshot }),
    previewHash: previewHash({
      request: requestWithoutPreview,
      targetCommand,
      payload: normalizedInput,
      expectedVersion: proposal.target_version,
      snapshot: proposal.target_snapshot,
      proposalId: proposal.id,
    }),
  }
}

export function createCommandRegistry(deps: CommandRegistryDependencies) {
  return {
    async preview(ctx: RegistryContext, request: CommandRequest) {
      const mutation = await normalize(deps, ctx, request)
      return {
        command: request.command,
        targetCommand: mutation.command,
        capability: { required: 'edit' as const, granted: true },
        approval: mutation.approval,
        actor: mutation.actor,
        ...(mutation.onBehalfOf ? { onBehalfOf: mutation.onBehalfOf } : {}),
        expectedVersion: mutation.expectedVersion,
        previewHash: mutation.previewHash,
        input: mutation.input,
      }
    },
    async execute(ctx: RegistryContext, request: CommandExecuteRequest) {
      const mutation = await normalize(deps, ctx, request)
      const replay = await deps.findReplay(mutation)
      if (replay) {
        if (!replay.sameInput) throw new CommandRegistryError('COMMAND_IDEMPOTENCY_CONFLICT', 409)
        return replay.result
      }
      if (request.previewHash !== mutation.previewHash) {
        throw new CommandRegistryError('COMMAND_PREVIEW_DRIFT', 409)
      }
      const result = request.command === 'proposal.apply'
        ? await deps.applyProposal(mutation)
        : mutation.command === 'work-item.create'
          ? await deps.createWorkItem(mutation)
          : await deps.updateWorkItem(mutation)
      return commandResult(mutation, result)
    },
  }
}
