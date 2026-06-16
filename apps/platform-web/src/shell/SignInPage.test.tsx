import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ThemeProvider } from "@product-suite/ui";

import { SignInPage } from "./SignInPage";

vi.mock("@clerk/clerk-react", () => ({
  SignIn: () => <div data-testid="clerk-signin" />,
}));

describe("SignInPage", () => {
  it("renders the Clerk sign-in widget and the theme toggle", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <SignInPage />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("clerk-signin")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    ).toBeDefined();
  });
});
