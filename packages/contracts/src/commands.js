export const COMMAND_API_VERSION = 1;

export const COMMAND_NAMES = [
  "work-item.create",
  "work-item.update",
  "proposal.apply",
];

export const COMMAND_ERROR_CODES = [
  "COMMAND_ENVELOPE_INVALID",
  "COMMAND_NOT_FOUND",
  "COMMAND_CAPABILITY_DENIED",
  "COMMAND_APPROVAL_REQUIRED",
  "COMMAND_VERSION_CONFLICT",
  "COMMAND_PREVIEW_DRIFT",
  "COMMAND_IDEMPOTENCY_CONFLICT",
  "COMMAND_EXECUTION_FAILED",
];

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "tenant",
  "tenantid",
  "tenant_id",
  "workspace",
  "workspaceid",
  "workspace_id",
  "actor",
  "actorid",
  "actor_id",
  "role",
  "capability",
  "approval",
  "onbehalfof",
  "on_behalf_of",
  "delegation",
]);

function invalid() {
  throw new TypeError("COMMAND_ENVELOPE_INVALID");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed, required) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function containsAuthority(value) {
  if (Array.isArray(value)) return value.some(containsAuthority);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase()) || containsAuthority(nested),
  );
}

function parseRequest(input, execute) {
  if (!isRecord(input)) invalid();
  const allowed = new Set([
    "version",
    "command",
    "idempotencyKey",
    "expectedVersion",
    "input",
    ...(execute ? ["previewHash"] : []),
  ]);
  const required = ["version", "command", "idempotencyKey", "input"];
  if (execute) required.push("previewHash");
  if (!hasExactKeys(input, allowed, required)) invalid();
  if (input.version !== COMMAND_API_VERSION || !COMMAND_NAMES.includes(input.command)) invalid();
  if (!isNonEmptyString(input.idempotencyKey) || input.idempotencyKey.length > 255) invalid();
  if (
    input.expectedVersion !== undefined &&
    (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
  ) invalid();
  if (!isRecord(input.input) || containsAuthority(input.input)) invalid();
  if (execute && !isNonEmptyString(input.previewHash)) invalid();
  return input;
}

export function parseCommandPreviewRequest(input) {
  return parseRequest(input, false);
}

export function parseCommandExecuteRequest(input) {
  return parseRequest(input, true);
}

function validPrincipal(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, new Set(["type", "id"]), ["type", "id"]) &&
    ["human", "agent", "service"].includes(value.type) &&
    isNonEmptyString(value.id)
  );
}

export function parseCommandResult(input) {
  if (!isRecord(input)) invalid();
  const allowed = new Set([
    "version",
    "command",
    "requestId",
    "idempotencyKey",
    "actor",
    "onBehalfOf",
    "capability",
    "approval",
    "retryable",
    "previewHash",
    "resourceVersion",
    "data",
  ]);
  const required = [
    "version",
    "command",
    "requestId",
    "idempotencyKey",
    "actor",
    "capability",
    "approval",
    "retryable",
    "previewHash",
    "resourceVersion",
    "data",
  ];
  if (!hasExactKeys(input, allowed, required)) invalid();
  if (input.version !== 1 || !COMMAND_NAMES.includes(input.command)) invalid();
  if (!isNonEmptyString(input.requestId) || !isNonEmptyString(input.idempotencyKey)) invalid();
  if (!validPrincipal(input.actor)) invalid();
  if (input.onBehalfOf !== undefined && !validPrincipal(input.onBehalfOf)) invalid();
  if (
    !isRecord(input.capability) ||
    !hasExactKeys(input.capability, new Set(["required", "granted"]), ["required", "granted"]) ||
    !["read", "edit", "configure"].includes(input.capability.required) ||
    typeof input.capability.granted !== "boolean"
  ) invalid();
  if (
    !isRecord(input.approval) ||
    !hasExactKeys(input.approval, new Set(["state", "source"]), ["state"]) ||
    !["not_required", "approved"].includes(input.approval.state) ||
    (input.approval.source !== undefined && !isNonEmptyString(input.approval.source))
  ) invalid();
  if (typeof input.retryable !== "boolean" || !isNonEmptyString(input.previewHash)) invalid();
  if (!Number.isSafeInteger(input.resourceVersion) || input.resourceVersion < 0) invalid();
  return input;
}

export function parseStableCommandError(input) {
  if (!isRecord(input) || !hasExactKeys(input, new Set(["error"]), ["error"])) invalid();
  const error = input.error;
  if (!isRecord(error)) invalid();
  if (
    !hasExactKeys(
      error,
      new Set(["code", "message", "requestId", "retryable", "details"]),
      ["code", "message", "requestId", "retryable"],
    )
  ) invalid();
  if (!COMMAND_ERROR_CODES.includes(error.code)) invalid();
  if (!isNonEmptyString(error.message) || !isNonEmptyString(error.requestId)) invalid();
  if (typeof error.retryable !== "boolean") invalid();
  if (error.details !== undefined && !isRecord(error.details)) invalid();
  return input;
}
