import { describe, expect, test } from "bun:test";

import { CommandApiError, createCommandClient } from "./commands.js";

function createTransport(responses: unknown[]) {
  const calls: Array<{ path: string; body: unknown; options: unknown }> = [];
  return {
    calls,
    async post(path: string, body: unknown, options: unknown) {
      calls.push({ path, body, options });
      return responses.shift();
    },
  };
}

const request = {
  version: 1 as const,
  command: "work-item.update" as const,
  idempotencyKey: "idem-1",
  expectedVersion: 7,
  input: { workItemId: "wi-1", patch: { title: "Shipped" } },
};

const preview = {
  command: "work-item.update" as const,
  targetCommand: "work-item.update" as const,
  capability: { required: "edit" as const, granted: true },
  approval: { state: "not_required" as const },
  actor: { type: "human" as const, id: "user-1" },
  expectedVersion: 7,
  previewHash: "sha256:preview",
  input: request.input,
};

const result = {
  version: 1 as const,
  command: "work-item.update" as const,
  requestId: "req-1",
  idempotencyKey: "idem-1",
  actor: { type: "human" as const, id: "user-1" },
  capability: { required: "edit" as const, granted: true },
  approval: { state: "not_required" as const },
  retryable: false,
  previewHash: "sha256:preview",
  resourceVersion: 8,
  data: { id: "wi-1" },
};

describe("command SDK client", () => {
  test("sends canonical preview envelopes and provider-neutral authority headers", async () => {
    const transport = createTransport([preview]);
    const client = createCommandClient({
      transport,
      workspaceId: "workspace-1",
      createRequestId: () => "req-1",
    });

    await expect(client.preview(request)).resolves.toEqual(preview);
    expect(transport.calls).toEqual([{
      path: "/api/v1/commands/work-item.update/preview",
      body: request,
      options: { headers: { "x-request-id": "req-1", "x-workspace-id": "workspace-1" } },
    }]);
  });

  test("executes with the preview hash while preserving idempotency and expected version", async () => {
    const transport = createTransport([result]);
    const client = createCommandClient({
      transport,
      workspaceId: "workspace-1",
      createRequestId: () => "req-1",
    });

    await expect(client.execute(request, preview.previewHash)).resolves.toEqual(result);
    expect(transport.calls[0]).toEqual({
      path: "/api/v1/commands/work-item.update/execute",
      body: { ...request, previewHash: preview.previewHash },
      options: { headers: { "x-request-id": "req-1", "x-workspace-id": "workspace-1" } },
    });
  });

  test("surfaces stable command errors with retry metadata", async () => {
    const error = {
      error: {
        code: "COMMAND_VERSION_CONFLICT",
        message: "COMMAND_VERSION_CONFLICT",
        requestId: "req-conflict",
        retryable: true,
        details: { expectedVersion: 7 },
      },
    };
    const client = createCommandClient({
      transport: createTransport([error]),
      workspaceId: "workspace-1",
    });

    try {
      await client.preview(request);
      throw new Error("expected preview to reject");
    } catch (cause) {
      expect(cause).toBeInstanceOf(CommandApiError);
      expect(cause).toMatchObject({
        code: "COMMAND_VERSION_CONFLICT",
        requestId: "req-conflict",
        retryable: true,
        details: { expectedVersion: 7 },
      });
    }
  });

  test("keeps retries caller-controlled and reuses the same execute envelope", async () => {
    const transport = createTransport([result, result]);
    const client = createCommandClient({
      transport,
      workspaceId: "workspace-1",
      createRequestId: () => "req-retry",
    });

    const first = await client.execute(request, preview.previewHash);
    const replay = await client.execute(request, preview.previewHash);

    expect(replay).toEqual(first);
    expect(transport.calls[1]?.body).toEqual(transport.calls[0]?.body);
    expect(transport.calls[1]?.options).toEqual(transport.calls[0]?.options);
  });

  test("rejects malformed results instead of treating them as terminal success", async () => {
    const client = createCommandClient({
      transport: createTransport([{ resourceVersion: 8, data: { id: "wi-1" } }]),
      workspaceId: "workspace-1",
    });

    await expect(client.execute(request, preview.previewHash)).rejects.toMatchObject({
      code: "COMMAND_EXECUTION_FAILED",
      retryable: false,
    });
  });

  test("does not unwrap a canonical result whose domain data has a version field", async () => {
    const versionedData = { ...result, data: { id: "wi-1", version: 8 } };
    const client = createCommandClient({
      transport: createTransport([versionedData]),
      workspaceId: "workspace-1",
    });

    await expect(client.execute(request, preview.previewHash)).resolves.toEqual(versionedData);
  });

  test("unwraps a transport-wrapped preview", async () => {
    const client = createCommandClient({
      transport: createTransport([{ data: preview }]),
      workspaceId: "workspace-1",
    });

    await expect(client.preview(request)).resolves.toEqual(preview);
  });

  test("rejects an incomplete preview even when it has a hash", async () => {
    const client = createCommandClient({
      transport: createTransport([{ previewHash: "sha256:preview" }]),
      workspaceId: "workspace-1",
    });
    await expect(client.preview(request)).rejects.toMatchObject({ code: "COMMAND_EXECUTION_FAILED" });
  });
});
