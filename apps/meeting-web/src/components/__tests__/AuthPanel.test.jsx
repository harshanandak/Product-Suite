import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthPanel, authPanelAllowsRegistration, resolveAuthPanelMode } from "../AuthPanel";

describe("AuthPanel", () => {
  test("hosted Neon mode keeps self-registration available", () => {
    expect(authPanelAllowsRegistration("hosted", "neon")).toBe(true);
    expect(resolveAuthPanelMode("register", "hosted", "neon")).toBe("register");
  });

  test("hosted auth renders Neon-specific copy", () => {
    const html = renderToStaticMarkup(
      <AuthPanel
        deploymentMode="hosted"
        authProvider="neon"
        authError=""
        isSubmitting={false}
        onLogin={() => {}}
        onRegister={() => {}}
        onHostedSignIn={() => {}}
        onHostedGoogleSignIn={() => {}}
        onHostedRegister={() => {}}
      />
    );

    expect(html).toContain("Neon Auth handles the hosted identity session");
  });

  test("non-hosted modes preserve register mode", () => {
    expect(authPanelAllowsRegistration("oss", "local")).toBe(true);
    expect(resolveAuthPanelMode("register", "oss", "local")).toBe("register");
  });
});
