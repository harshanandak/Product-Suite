import { describe, it, expect } from "vitest";
import {
  BOARDS,
  type BoardId,
  deriveActiveBoard,
  href,
  interpolate,
  resolveScreen,
  workspaceDisplayName,
} from "./boards";

describe("BOARDS", () => {
  it("declares the five boards in canonical dock order", () => {
    const ids = BOARDS.map((board) => board.id);
    const expected: BoardId[] = [
      "home",
      "workboard",
      "meetings",
      "canvas",
      "agents",
    ];
    expect(ids).toEqual(expected);
  });
});

describe("deriveActiveBoard", () => {
  it("maps a board root and content screens to the owning board", () => {
    expect(deriveActiveBoard("/w/x", "x")).toBe("home");
    expect(deriveActiveBoard("/w/x/review", "x")).toBe("home");
    expect(deriveActiveBoard("/w/x/workboard/strategy", "x")).toBe("workboard");
  });

  it("returns null for non-board surfaces and foreign paths", () => {
    expect(deriveActiveBoard("/w/x/settings", "x")).toBeNull();
    expect(deriveActiveBoard("/other", "x")).toBeNull();
  });
});

describe("interpolate", () => {
  it("substitutes the $workspace placeholder", () => {
    expect(interpolate("/w/$workspace/workboard", "acme")).toBe(
      "/w/acme/workboard",
    );
  });
});

describe("href", () => {
  it("returns the interpolated concrete path", () => {
    expect(href("/w/$workspace/agents/approvals", "acme")).toBe(
      "/w/acme/agents/approvals",
    );
  });
});

describe("workspaceDisplayName", () => {
  it("title-cases a slug and uppercases short tokens", () => {
    expect(workspaceDisplayName("befach-hq")).toBe("Befach HQ");
  });
});

describe("resolveScreen", () => {
  it("titles a matched board item by its label", () => {
    expect(resolveScreen("/w/x/workboard", "x").title).toBe("Work items");
  });

  it("titles the settings surface explicitly", () => {
    expect(resolveScreen("/w/x/settings", "x").title).toBe("Settings");
  });
});
