import { describe, expect, it } from "vitest";

import MeetingsPage, { dynamic as meetingsDynamic } from "../../../meetings/page";
import WorkspaceMeetingsPage, { dynamic } from "./page";

describe("workspace meetings route", () => {
  it("reuses the platform meetings page and dynamic behavior", () => {
    expect(WorkspaceMeetingsPage).toBe(MeetingsPage);
    expect(dynamic).toBe(meetingsDynamic);
  });
});
