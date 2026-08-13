import type { CommandErrorCode } from '@product-suite/contracts'

const STATUS_BY_CODE: Record<CommandErrorCode, 400 | 403 | 404 | 409 | 500> = {
  COMMAND_ENVELOPE_INVALID: 400,
  COMMAND_NOT_FOUND: 404,
  COMMAND_CAPABILITY_DENIED: 403,
  COMMAND_APPROVAL_REQUIRED: 403,
  COMMAND_VERSION_CONFLICT: 409,
  COMMAND_PREVIEW_DRIFT: 409,
  COMMAND_IDEMPOTENCY_CONFLICT: 409,
  COMMAND_EXECUTION_FAILED: 500,
}

export class CommandError extends Error {
  constructor(
    public readonly code: CommandErrorCode,
    message: string,
    public readonly requestId: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

export function commandErrorResponse(error: CommandError) {
  const details = error.details === undefined ? {} : { details: error.details }
  return {
    status: STATUS_BY_CODE[error.code],
    body: {
      error: {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        retryable: error.code === 'COMMAND_VERSION_CONFLICT',
        ...details,
      },
    },
  }
}
