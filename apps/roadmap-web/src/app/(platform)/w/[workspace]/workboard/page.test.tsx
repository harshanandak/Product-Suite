import { describe, expect, it } from "vitest";

import RoadmapPage from "../../../roadmap/page";
import WorkspaceWorkboardPage from "./page";

describe("workspace workboard route", () => {
  it("reuses the platform roadmap page", () => {
    expect(WorkspaceWorkboardPage).toBe(RoadmapPage);
  });
});
