import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type MockUser = {
  fullName: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  imageUrl: string;
} | null;

const { userRef } = vi.hoisted(() => ({
  userRef: { current: null as MockUser },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: userRef.current }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

import { UserMenu } from "./UserMenu";

describe("UserMenu", () => {
  beforeEach(() => {
    userRef.current = null;
  });

  it("renders a token-native trigger with the session initials", () => {
    userRef.current = {
      fullName: "Ada Lovelace",
      primaryEmailAddress: { emailAddress: "ada@example.com" },
      imageUrl: "",
    };
    render(<UserMenu />);
    expect(
      screen.getByRole("button", { name: "Open user menu" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("falls back to an Account label + initial when there is no profile", () => {
    userRef.current = {
      fullName: null,
      primaryEmailAddress: null,
      imageUrl: "",
    };
    render(<UserMenu />);
    expect(
      screen.getByRole("button", { name: "Open user menu" }),
    ).toBeInTheDocument();
    // name -> "Account" -> initial "A" (never an empty label).
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
