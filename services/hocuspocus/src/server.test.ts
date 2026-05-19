import { describe, expect, test } from "bun:test";

import { createHocuspocusServer } from "./server";

describe("hocuspocus server factory", () => {
  test("constructs the injected Hocuspocus server implementation with configured hooks", () => {
    class FakeServer {
      constructor(public configuredOptions: unknown) {}
    }

    const server = createHocuspocusServer(
      { runtime: { port: 1234 } },
      FakeServer as never,
    ) as unknown as FakeServer;

    expect(server.configuredOptions).toMatchObject({ port: 1234 });
  });
});
