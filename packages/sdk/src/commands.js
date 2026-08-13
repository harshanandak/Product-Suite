import {
  parseCommandExecuteRequest,
  parseCommandPreviewRequest,
  parseCommandResult,
  parseStableCommandError,
} from "@product-suite/contracts";

/** @typedef {import("@product-suite/contracts").CommandRequest} CommandRequest */
/** @typedef {import("@product-suite/contracts").StableCommandError["error"]} StableError */
/** @typedef {{ post(path: string, body: unknown, options?: unknown): Promise<unknown> }} CommandTransport */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class CommandApiError extends Error {
  /** @param {StableError} error */
  constructor(error) {
    super(error.message);
    this.name = "CommandApiError";
    this.code = error.code;
    this.requestId = error.requestId;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

/** @param {unknown} response */
function unwrapResponse(response) {
  if (isRecord(response) && "data" in response && isRecord(response.data)) {
    const wrapped = response.data;
    if ("error" in wrapped || "version" in wrapped) return wrapped;
  }
  return response;
}

/** @param {unknown} response @param {string} requestId */
function parseResponse(response, requestId) {
  const body = unwrapResponse(response);
  if (isRecord(body) && "error" in body) {
    const stable = parseStableCommandError(body);
    throw new CommandApiError(stable.error);
  }
  try {
    return parseCommandResult(body);
  } catch {
    throw new CommandApiError({
      code: "COMMAND_EXECUTION_FAILED",
      message: "Invalid command result",
      requestId,
      retryable: false,
    });
  }
}

/** @param {unknown} response @param {string} requestId */
function parsePreview(response, requestId) {
  const body = unwrapResponse(response);
  if (isRecord(body) && "error" in body) {
    const stable = parseStableCommandError(body);
    throw new CommandApiError(stable.error);
  }
  if (!isRecord(body) || typeof body.previewHash !== "string" || body.previewHash.length === 0) {
    throw new CommandApiError({
      code: "COMMAND_EXECUTION_FAILED",
      message: "Invalid command preview",
      requestId,
      retryable: false,
    });
  }
  return body;
}

/**
 * @param {{ transport: CommandTransport; workspaceId: string; createRequestId?: () => string }} options
 */
export function createCommandClient({ transport, workspaceId, createRequestId = () => crypto.randomUUID() }) {
  if (typeof transport?.post !== "function") {
    throw new TypeError("Command API transport requires a post method");
  }
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new TypeError("Command API client requires a workspace id");
  }

  /** @param {string} requestId */
  function options(requestId) {
    return { headers: { "x-request-id": requestId, "x-workspace-id": workspaceId } };
  }

  return {
    /** @param {CommandRequest} request */
    async preview(request) {
      const envelope = parseCommandPreviewRequest(request);
      const requestId = createRequestId();
      const response = await transport.post(
        `/api/v1/commands/${encodeURIComponent(envelope.command)}/preview`,
        envelope,
        options(requestId),
      );
      return parsePreview(response, requestId);
    },
    /** @param {CommandRequest} request @param {string} previewHash */
    async execute(request, previewHash) {
      const envelope = parseCommandExecuteRequest({ ...request, previewHash });
      const requestId = createRequestId();
      const response = await transport.post(
        `/api/v1/commands/${encodeURIComponent(envelope.command)}/execute`,
        envelope,
        options(requestId),
      );
      return parseResponse(response, requestId);
    },
  };
}
