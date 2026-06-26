import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../test/harness";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

describe("WorkspaceSwitcher", () => {
  it("renders the workspace display name inside a link", async () => {
    // /w/test-ws → useParams workspace="test-ws" → workspaceDisplayName → "Test WS".
    renderWithRouter(<WorkspaceSwitcher />, { path: "/w/test-ws" });

    // The router resolves the initial route asynchronously, so await the name.
    const name = await screen.findByText("Test WS");
    expect(name).toBeDefined();

    // The name lives inside the switcher's <Link>, which renders as an anchor.
    expect(name.closest("a")).not.toBeNull();
  });

  it("hides the name when collapsed but keeps the link accessible", async () => {
    renderWithRouter(<WorkspaceSwitcher collapsed />, { path: "/w/test-ws" });

    // The collapsed rail shows only the avatar; the workspace name is dropped.
    const link = await screen.findByRole("link", { name: "Test WS workspace" });
    expect(link).toBeInTheDocument();
    expect(screen.queryByText("Test WS")).not.toBeInTheDocument();
  });
});
