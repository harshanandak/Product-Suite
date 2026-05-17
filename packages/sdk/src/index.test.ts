import { describe, expect, test } from "bun:test";

import { createMeetingApiClient } from "./index.js";

describe("sdk package exports", () => {
  test("exports the meeting API client factory", () => {
    expect(createMeetingApiClient).toBeFunction();
  });
});
