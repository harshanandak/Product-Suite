import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsScreen } from "./SettingsScreen";

describe("SettingsScreen", () => {
  it("renders the Settings page with an Agents section and Connectors", () => {
    render(<SettingsScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Connectors" }),
    ).toBeInTheDocument();
  });

  it("marks the rehomed connectors as coming-soon, not live data", () => {
    render(<SettingsScreen />);

    // The connectors are honest placeholders — at least one "Coming soon" badge.
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0);
    // A sample of the previewed connectors renders.
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });
});
