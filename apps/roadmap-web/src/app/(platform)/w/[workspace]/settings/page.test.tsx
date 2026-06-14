import { describe, expect, it } from "vitest";

import SettingsPage from "../../../settings/page";
import WorkspaceSettingsPage from "./page";

describe("workspace settings route", () => {
  it("reuses the platform settings page", () => {
    expect(WorkspaceSettingsPage).toBe(SettingsPage);
  });
});
