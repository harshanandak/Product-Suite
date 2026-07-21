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

    // BOTH placeholder cards must carry a "Coming soon" badge — asserting the
    // exact count catches a removed/renamed card that a `> 0` check would miss.
    expect(screen.getAllByText(/coming soon/i)).toHaveLength(2);
    // The two placeholders are the Connectors card and the Agent configuration
    // card — assert each heading explicitly, not just that some badge exists.
    expect(
      screen.getByRole("heading", { name: "Connectors" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Agent configuration" }),
    ).toBeInTheDocument();
    // A sample of the previewed connectors renders.
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
  });
});
