import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../test/harness";
import { BoardScreen } from "./BoardScreen";

describe("BoardScreen", () => {
  it("renders the screen heading and the empty-state coming-soon copy", async () => {
    renderWithRouter(<BoardScreen />, { path: "/w/test-ws/workboard" });

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Work items",
    });
    expect(heading).toBeDefined();
    expect(screen.getByText(/coming soon/i)).toBeDefined();
  });
});
