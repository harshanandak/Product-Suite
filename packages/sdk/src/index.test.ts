import { describe, expect, test } from "bun:test";

import { CommandApiError, createCommandClient, createMeetingApiClient } from "./index.js";

describe("sdk package exports", () => {
  test("exports the meeting API client factory", () => {
    expect(createMeetingApiClient).toBeFunction();
  });

  test("exports the governed command client", () => {
    expect(createCommandClient).toBeFunction();
    expect(CommandApiError).toBeFunction();
  });
});
