import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../test/harness";
import { BoardScreen } from "./BoardScreen";

describe("BoardScreen", () => {
  it("renders the screen heading and the empty-state coming-soon copy", async () => {
    // BoardScreen is the placeholder for boards that still lack real content
    // (meetings/canvas/agents); /workboard now renders the live WorkboardScreen.
    renderWithRouter(<BoardScreen />, { path: "/w/test-ws/meetings" });

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "All meetings",
    });
    expect(heading).toBeDefined();
    expect(screen.getByText(/coming soon/i)).toBeDefined();
  });
});
