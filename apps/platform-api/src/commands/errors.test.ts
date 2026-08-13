import { describe, expect, it } from 'vitest'

import { CommandError, commandErrorResponse } from './errors'

describe('commandErrorResponse', () => {
  it.each([
    ['COMMAND_NOT_FOUND', 404],
    ['COMMAND_CAPABILITY_DENIED', 403],
    ['COMMAND_VERSION_CONFLICT', 409],
    ['COMMAND_PREVIEW_DRIFT', 409],
    ['COMMAND_IDEMPOTENCY_CONFLICT', 409],
    ['COMMAND_ENVELOPE_INVALID', 400],
  ] as const)('maps %s to the stable status and envelope', (code, status) => {
    const response = commandErrorResponse(new CommandError(code, 'message', 'req-1'))
    expect(response).toEqual({
      status,
      body: {
        error: {
          code,
          message: 'message',
          requestId: 'req-1',
          retryable: code === 'COMMAND_VERSION_CONFLICT',
        },
      },
    })
  })
})
