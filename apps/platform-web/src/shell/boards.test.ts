import { describe, it, expect } from "vitest";
import {
  BOARDS,
  type BoardId,
  buildWorkboardItems,
  deriveActiveBoard,
  getBoard,
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

  it("inserts a slug containing '$' literally, not as a replacement pattern", () => {
    expect(interpolate("/w/$workspace/inbox", "a$$b")).toBe("/w/a$$b/inbox");
    expect(interpolate("/w/$workspace/inbox", "x$&y")).toBe("/w/x$&y/inbox");
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
    expect(resolveScreen("/w/x/workboard", "x").title).toBe("My items");
  });

  it("titles the settings surface explicitly", () => {
    expect(resolveScreen("/w/x/settings", "x").title).toBe("Settings");
  });
});

describe("workboard nav (IA redesign)", () => {
  const workboardItems = () => getBoard("workboard").items;

  it("declares exactly My items, Views, Projects as the static workboard rows", () => {
    expect(workboardItems().map((item) => item.key)).toEqual([
      "my-items",
      "views",
      "projects",
    ]);
  });

  it("Views is a real destination (Phase 2), Projects is still prototype-only", () => {
    const views = workboardItems().find((item) => item.key === "views");
    expect(views?.to).toBe("/w/$workspace/workboard/views");
    expect(views?.prototypeOnly).toBeUndefined();

    const projects = workboardItems().find((item) => item.key === "projects");
    expect(projects?.prototypeOnly).toBe(true);
    expect(projects?.to).toBeUndefined();
  });

  it("has no strategy/insights/tasks/triage/feedback/intake/graph entries", () => {
    const keys = new Set(workboardItems().map((item) => item.key));
    for (const dead of [
      "strategy",
      "insights",
      "tasks",
      "triage",
      "feedback",
      "intake",
      "graph",
    ]) {
      expect(keys.has(dead)).toBe(false);
    }
  });

  it("buildWorkboardItems appends a TEAMS section with one row per team", () => {
    const items = buildWorkboardItems([
      { id: "engineering", name: "Engineering" },
      { id: "growth", name: "Growth" },
    ]);
    const section = items.find((item) => item.section);
    expect(section?.label).toBe("Teams");

    const eng = items.find((item) => item.key === "team-engineering");
    expect(eng?.label).toBe("Engineering");
    expect(eng?.to).toBe("/w/$workspace/workboard/team/engineering");

    const growth = items.find((item) => item.key === "team-growth");
    expect(growth?.to).toBe("/w/$workspace/workboard/team/growth");
  });

  it("buildWorkboardItems with no teams omits the section header", () => {
    const items = buildWorkboardItems([]);
    expect(items.map((item) => item.key)).toEqual([
      "my-items",
      "views",
      "projects",
    ]);
    expect(items.some((item) => item.section)).toBe(false);
  });

  it("resolveScreen titles a team screen from extraItems", () => {
    const extra = buildWorkboardItems([
      { id: "engineering", name: "Engineering" },
    ]);
    const resolved = resolveScreen(
      "/w/x/workboard/team/engineering",
      "x",
      extra,
    );
    expect(resolved.board?.id).toBe("workboard");
    expect(resolved.title).toBe("Engineering");
  });
});
