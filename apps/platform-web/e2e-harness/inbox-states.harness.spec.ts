import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(here, "screenshots");

/**
 * Visual verification of the three atomic-accept states, each rendered by the REAL
 * {@link ProposalDetail} against a MOCKED accept envelope (see inbox-states.tsx).
 * Clicks each panel's Accept and screenshots the resulting banner:
 *   1. applied         → optimistic "Applied. View item →"
 *   2. needs-attention → invalid, plain-language field errors + retry/edit/discard
 *   3. changed         → stale, "This item changed" + refresh/discard/apply-anyway
 */
test("captures applied / needs-attention / changed accept states", async ({ page }) => {
  await page.goto("/");

  const applied = page.locator('[data-state="applied"]');
  await applied.getByRole("button", { name: "Accept" }).click();
  await expect(applied.getByText("Applied.")).toBeVisible();
  await expect(applied.getByRole("link", { name: /View item/ })).toBeVisible();
  await applied.screenshot({ path: path.join(shotDir, "01-applied.png") });

  const needsAttention = page.locator('[data-state="needs-attention"]');
  await needsAttention.getByRole("button", { name: "Accept" }).click();
  await expect(needsAttention.getByText("Couldn’t apply this proposal")).toBeVisible();
  await expect(needsAttention.getByText("Team not found — it may have been deleted.")).toBeVisible();
  await expect(needsAttention.getByRole("button", { name: "Retry" })).toBeVisible();
  await needsAttention.screenshot({ path: path.join(shotDir, "02-needs-attention.png") });

  const changed = page.locator('[data-state="changed"]');
  await changed.getByRole("button", { name: "Accept" }).click();
  await expect(changed.getByText("This item changed", { exact: true })).toBeVisible();
  await expect(changed.getByText(/Proposed against version 4 · now at version 7\./)).toBeVisible();
  await expect(changed.getByRole("button", { name: "Apply anyway" })).toBeVisible();
  await changed.screenshot({ path: path.join(shotDir, "03-item-changed.png") });

  await page.screenshot({ path: path.join(shotDir, "00-all-states.png"), fullPage: true });
});
