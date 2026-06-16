import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ThemeProvider } from "@product-suite/ui";

import { SetupNotice } from "./SetupNotice";

describe("SetupNotice", () => {
  it("prompts the user to add a Clerk publishable key", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <SetupNotice />
      </ThemeProvider>,
    );

    expect(
      screen.getByText("Add a Clerk publishable key to enable sign-in."),
    ).toBeInTheDocument();
  });

  it("lists the VITE_CLERK_PUBLISHABLE_KEY setup step", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <SetupNotice />
      </ThemeProvider>,
    );

    expect(screen.getByText("VITE_CLERK_PUBLISHABLE_KEY")).toBeInTheDocument();
  });
});
