import { describe, it, expect } from "vitest";
import {
  BOARDS,
  type BoardId,
  buildHomeItems,
  buildWorkboardItems,
  deriveActiveBoard,
  getBoard,
  href,
  interpolate,
  resolveScreen,
  workspaceDisplayName,
} from "./boards";

describe("BOARDS", () => {
  it("declares the four boards in canonical dock order (Agent board removed)", () => {
    const ids = BOARDS.map((board) => board.id);
    const expected: BoardId[] = ["home", "workboard", "meetings", "canvas"];
    expect(ids).toEqual(expected);
  });

  it("no longer declares the deleted Agent board", () => {
    expect(BOARDS.some((board) => board.id === ("agents" as BoardId))).toBe(
      false,
    );
  });
});

describe("buildHomeItems — live review-queue count", () => {
  it("carries NO hardcoded counts in the static home board (counts are live)", () => {
    // Regression guard: the static config once baked in `count: 4`/`count: 2`
    // literals that lied while the queue was empty. The board must ship no
    // count on any home row — the live value is threaded in at render.
    const home = getBoard("home");
    expect(home.items.every((item) => item.count === undefined)).toBe(true);
  });

  it("renders no review badge when there are zero pending proposals", () => {
    const review = buildHomeItems(0).find((item) => item.key === "review");
    expect(review?.count).toBeUndefined();
  });

  it("sets the review count to the live pending-proposal count", () => {
    const review = buildHomeItems(7).find((item) => item.key === "review");
    expect(review?.count).toBe(7);
  });

  it("never puts a count on Chat (no live unread source yet)", () => {
    const chat = buildHomeItems(7).find((item) => item.key === "chat");
    expect(chat?.count).toBeUndefined();
  });
});

describe("deriveActiveBoard — deleted Agent board", () => {
  it("returns null for agents/* paths so they fall through to notFound", () => {
    expect(deriveActiveBoard("/w/x/agents", "x")).toBeNull();
    expect(deriveActiveBoard("/w/x/agents/approvals", "x")).toBeNull();
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
    expect(href("/w/$workspace/canvas/starred", "acme")).toBe(
      "/w/acme/canvas/starred",
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

describe("meeting nav (honest nav)", () => {
  const meetingItems = () => getBoard("meetings").items;

  it("declares exactly All meetings and Triage queue", () => {
    expect(meetingItems().map((item) => item.key)).toEqual([
      "all-meetings",
      "triage-queue",
    ]);
  });

  it("has no This week / Action items / Jobs rows and no Processing section", () => {
    const keys = new Set(meetingItems().map((item) => item.key));
    for (const stub of ["this-week", "action-items", "jobs", "processing"]) {
      expect(keys.has(stub)).toBe(false);
    }
    expect(meetingItems().some((item) => item.section)).toBe(false);
  });

  it("carries NO hardcoded counts (a count comes from data or does not exist)", () => {
    // The board once shipped `action-items: 4`, `triage-queue: 2`, `jobs: 1` —
    // literals that lied about surfaces which held no real data at all.
    expect(meetingItems().every((item) => item.count === undefined)).toBe(true);
  });

  it("resolveScreen still titles the surviving meeting rows", () => {
    expect(resolveScreen("/w/x/meetings", "x").title).toBe("All meetings");
    const triage = resolveScreen("/w/x/meetings/triage", "x");
    expect(triage.board?.id).toBe("meetings");
    expect(triage.title).toBe("Triage queue");
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

  it("Views and Projects are both real destinations, not prototype toasts", () => {
    const views = workboardItems().find((item) => item.key === "views");
    expect(views?.to).toBe("/w/$workspace/workboard/views");
    expect(views?.prototypeOnly).toBeUndefined();

    // Projects went live with the Projects board; it must navigate rather than
    // raise the prototype toast it showed while the surface was unbuilt.
    const projects = workboardItems().find((item) => item.key === "projects");
    expect(projects?.to).toBe("/w/$workspace/projects");
    expect(projects?.prototypeOnly).toBeUndefined();
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
