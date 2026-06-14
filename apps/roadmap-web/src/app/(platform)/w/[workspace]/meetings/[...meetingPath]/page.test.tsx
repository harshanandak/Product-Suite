import { describe, expect, it } from "vitest";

import MeetingsPage, { dynamic as meetingsDynamic } from "../../../../meetings/page";
import WorkspaceMeetingPathPage, { dynamic } from "./page";

describe("workspace meeting path route", () => {
  it("reuses the platform meetings page and dynamic behavior", () => {
    expect(WorkspaceMeetingPathPage).toBe(MeetingsPage);
    expect(dynamic).toBe(meetingsDynamic);
  });
});
