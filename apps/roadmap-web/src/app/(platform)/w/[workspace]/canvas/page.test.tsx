import { describe, expect, it } from "vitest";

import CanvasPage from "../../../canvas/page";
import WorkspaceCanvasPage from "./page";

describe("workspace canvas route", () => {
  it("reuses the platform canvas page", () => {
    expect(WorkspaceCanvasPage).toBe(CanvasPage);
  });
});
