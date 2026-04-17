import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthPanel, authPanelAllowsRegistration, resolveAuthPanelMode } from "../components/AuthPanel";

describe("AuthPanel", () => {
  test("hosted Neon mode keeps self-registration available", () => {
    expect(authPanelAllowsRegistration("hosted", "neon")).toBe(true);
    expect(resolveAuthPanelMode("register", "hosted", "neon")).toBe("register");
  });

  test("hosted auth renders Neon-specific copy and Google entry", () => {
    const html = renderToStaticMarkup(
      createElement(AuthPanel, {
        deploymentMode: "hosted",
        authProvider: "neon",
        authError: "",
        isSubmitting: false,
        onLogin: () => {},
        onRegister: () => {},
        onHostedSignIn: () => {},
        onHostedGoogleSignIn: () => {},
        onHostedRegister: () => {},
      })
    );

    expect(html).toContain("HOSTED ACCESS");
    expect(html).toContain("Neon Auth handles the hosted identity session");
    expect(html).toContain("Continue with Google");
  });

  test("non-hosted modes preserve register mode", () => {
    expect(authPanelAllowsRegistration("oss", "local")).toBe(true);
    expect(resolveAuthPanelMode("register", "oss", "local")).toBe("register");
  });
});
