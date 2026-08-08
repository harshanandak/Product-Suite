import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM (`"type": "module"`): derive dir from import.meta, not __dirname.
const here = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(here, ".auth", "user.json");
const secretKey = process.env.CLERK_SECRET_KEY?.trim();
const publishableKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim();
const identifier = process.env.E2E_CLERK_USER?.trim();
const missingClerkInputs = [
  secretKey ? null : "CLERK_SECRET_KEY",
  publishableKey
    ? null
    : "publishable key (VITE_CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY)",
  identifier ? null : "E2E_CLERK_USER",
].filter((name): name is string => name !== null);

setup.skip(
  missingClerkInputs.length > 0,
  `INCOMPLETE: missing Clerk inputs: ${missingClerkInputs.join(", ")}`,
);

/**
 * Authenticate a real Clerk test user and persist storageState so every spec in
 * the `chromium` project starts already signed in.
 *
 * Required env (see .dev.vars.example):
 *  - CLERK_SECRET_KEY          — backend key; `clerkSetup` mints a Testing Token,
 *                                 and `clerk.signIn({ emailAddress })` mints a
 *                                 short-lived sign-in token for the ticket flow.
 *  - VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY — the same publishable
 *                                 key the app boots with.
 *  - E2E_CLERK_USER            — a Clerk test-mode fixture user in that instance.
 *                                 It has NO password; we sign in via a Backend-API
 *                                 sign-in token (strategy "ticket"), so no password
 *                                 or email code is needed.
 *
 * The publishable key must belong to the SAME Clerk instance the web app is
 * built against, or the injected testing token won't match window.Clerk.
 */
setup("authenticate via Clerk", async ({ page }) => {
  // Obtains a Clerk Testing Token (uses CLERK_SECRET_KEY) so programmatic
  // sign-in bypasses bot protection. Pass the key explicitly since the app uses
  // the VITE_-prefixed name.
  await clerkSetup({ publishableKey });

  // Load a page where the Clerk SDK is present, then sign in programmatically
  // (no UI dependency on Clerk's hosted forms). The `emailAddress` form of
  // @clerk/testing's signIn mints a short-lived sign-in token via the Backend
  // API (uses CLERK_SECRET_KEY) and signs in with strategy "ticket" — so a
  // password-less test-mode fixture user works without a password or email code.
  // It injects the testing token internally, so no explicit setup call here.
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: identifier as string });

  // Prove the session took by loading an authenticated route before saving.
  const workspace = process.env.E2E_WORKSPACE ?? "befach-hq";
  await page.goto(`/w/${workspace}/workboard`);
  // The TopBar's "Ask agent" button only renders inside the authenticated shell.
  await expect(page.getByRole("button", { name: "Ask agent" })).toBeVisible();

  // A fresh checkout has no `e2e/.auth/` (it's gitignored), so create it before
  // writing — `storageState` does not mkdir the parent and would otherwise ENOENT.
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
