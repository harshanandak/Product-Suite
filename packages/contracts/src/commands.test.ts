import { describe, expect, it } from 'bun:test'

import {
  COMMAND_API_VERSION,
  parseCommandExecuteRequest,
  parseCommandPreviewRequest,
  parseCommandResult,
  parseStableCommandError,
} from './commands.js'

const previewRequest = {
  version: 1,
  command: 'work-item.update',
  idempotencyKey: 'retry-123',
  expectedVersion: 7,
  input: { workItemId: 'item-1', patch: { title: 'Governed' } },
}

describe('command envelopes', () => {
  it('round-trips strict versioned preview and execute requests', () => {
    expect(COMMAND_API_VERSION).toBe(1)
    expect(parseCommandPreviewRequest(JSON.parse(JSON.stringify(previewRequest)))).toEqual(
      previewRequest,
    )
    expect(
      parseCommandExecuteRequest({ ...previewRequest, previewHash: 'sha256:abc123' }),
    ).toEqual({ ...previewRequest, previewHash: 'sha256:abc123' })
  })

  it.each([
    { ...previewRequest, version: 2 },
    { ...previewRequest, extra: true },
    { ...previewRequest, tenantId: 'forged' },
    { ...previewRequest, actor: { id: 'forged' } },
    { ...previewRequest, role: 'owner' },
    { ...previewRequest, approval: { state: 'approved' } },
    { ...previewRequest, input: { ...previewRequest.input, onBehalfOf: 'agent-1' } },
    { ...previewRequest, input: { ...previewRequest.input, delegation: ['agent-1'] } },
  ])('rejects invalid or client-supplied authority: %#', (request) => {
    expect(() => parseCommandPreviewRequest(request)).toThrow('COMMAND_ENVELOPE_INVALID')
  })

  it('parses server-derived results with capability, approval, provenance, and retry metadata', () => {
    const result = {
      version: 1,
      command: 'proposal.apply',
      requestId: 'req-1',
      idempotencyKey: 'retry-123',
      actor: { type: 'human', id: 'user-1' },
      onBehalfOf: { type: 'agent', id: 'agent-1' },
      capability: { required: 'edit', granted: true },
      approval: { state: 'approved', source: 'stored_proposal' },
      retryable: false,
      previewHash: 'sha256:abc123',
      resourceVersion: 8,
      data: { workItemId: 'item-1' },
    }
    expect(parseCommandResult(result)).toEqual(result)
  })

  it('parses the stable machine error envelope', () => {
    const error = {
      error: {
        code: 'COMMAND_VERSION_CONFLICT',
        message: 'The resource changed',
        requestId: 'req-1',
        retryable: true,
        details: { expectedVersion: 7 },
      },
    }
    expect(parseStableCommandError(error)).toEqual(error)
  })
})
