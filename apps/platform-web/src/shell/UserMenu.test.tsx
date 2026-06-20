import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({
    user: {
      fullName: "Ada Lovelace",
      primaryEmailAddress: { emailAddress: "ada@example.com" },
      imageUrl: "",
    },
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

import { UserMenu } from "./UserMenu";

describe("UserMenu", () => {
  it("renders a token-native trigger with the session initials", () => {
    render(<UserMenu />);
    expect(
      screen.getByRole("button", { name: "Open user menu" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
