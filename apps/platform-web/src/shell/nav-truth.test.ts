import { describe, expect, it } from "vitest";

import { InboxScreen } from "@/boards/inbox/InboxScreen";
import { router } from "@/router";

import { BoardScreen } from "./BoardScreen";
import { buildHomeItems } from "./boards";

/**
 * Nav truth (UX audit F1): the badge-bearing row must navigate to the queue it
 * counts. These assertions bind the sidebar config to the ROUTE TREE — a label
 * alone can't prove the destination is real, and the previous shape of this bug
 * was exactly a correct label over a placeholder route.
 */
const routesById = router.routesById as unknown as Record<
  string,
  { options: { component?: unknown } } | undefined
>;

describe("home rail nav targets (F1)", () => {
  it("routes the counted row to the live queue screen, not a placeholder", () => {
    const counted = buildHomeItems(5).filter((item) => item.count !== undefined);
    expect(counted).toHaveLength(1);

    const route = routesById[counted[0].to as string];
    expect(route, `no route registered for ${counted[0].to}`).toBeDefined();
    expect(route?.options.component).toBe(InboxScreen);
    expect(route?.options.component).not.toBe(BoardScreen);
  });

  it("no longer registers the /review placeholder route", () => {
    expect(routesById["/w/$workspace/review"]).toBeUndefined();
  });
});
