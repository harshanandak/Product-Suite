import { describe, expect, test } from "bun:test";

import { HOCUSPOCUS_SERVICE_NAME } from "./index";

describe("hocuspocus service registration", () => {
  test("exposes the realtime transport service name", () => {
    expect(HOCUSPOCUS_SERVICE_NAME).toBe("hocuspocus");
  });
});
