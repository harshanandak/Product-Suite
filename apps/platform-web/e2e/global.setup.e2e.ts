import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM (`"type": "module"`): derive dir from import.meta, not __dirname.
const here = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(here, ".auth", "user.json");

/**
 * Authenticate a real Clerk test user and persist storageState so every spec in
 * the `chromium` project starts already signed in.
 *
 * Required env (see .dev.vars.example):
 *  - CLERK_SECRET_KEY          — backend key; `clerkSetup` mints a Testing Token.
 *  - VITE_CLERK_PUBLISHABLE_KEY — the same publishable key the app boots with
 *                                 (main.tsx reads it via env.ts / CLERK_PUBLISHABLE_KEY).
 *  - E2E_CLERK_USER / E2E_CLERK_PASSWORD — a password-strategy test user in that
 *                                 Clerk instance.
 *
 * The publishable key must belong to the SAME Clerk instance the web app is
 * built against, or the injected testing token won't match window.Clerk.
 */
setup("authenticate via Clerk", async ({ page }) => {
  const publishableKey =
    process.env.VITE_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY;

  // Obtains a Clerk Testing Token (uses CLERK_SECRET_KEY) so programmatic
  // sign-in bypasses bot protection. Pass the key explicitly since the app uses
  // the VITE_-prefixed name.
  await clerkSetup({ publishableKey });

  const identifier = process.env.E2E_CLERK_USER;
  const password = process.env.E2E_CLERK_PASSWORD;
  if (!identifier || !password) {
    throw new Error(
      "E2E_CLERK_USER and E2E_CLERK_PASSWORD must be set to sign in (see e2e/README.md).",
    );
  }

  // Load a page where the Clerk SDK is present, inject the testing token, then
  // sign in programmatically (no UI dependency on Clerk's hosted forms).
  await page.goto("/");
  await setupClerkTestingToken({ page });
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier, password },
  });

  // Prove the session took by loading an authenticated route before saving.
  const workspace = process.env.E2E_WORKSPACE ?? "befach-hq";
  await page.goto(`/w/${workspace}/workboard`);
  // The TopBar's "Ask agent" button only renders inside the authenticated shell.
  await expect(page.getByRole("button", { name: "Ask agent" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
