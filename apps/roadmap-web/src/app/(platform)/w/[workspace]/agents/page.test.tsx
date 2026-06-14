import { describe, expect, it } from "vitest";

import AgentsPage from "../../../agents/page";
import WorkspaceAgentsPage from "./page";

describe("workspace agents route", () => {
  it("reuses the platform agents page", () => {
    expect(WorkspaceAgentsPage).toBe(AgentsPage);
  });
});
