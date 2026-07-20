import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(here, "screenshots");

/**
 * Visual verification of the inline proposal card (PRIMARY surface) and the
 * Review Inbox, each rendered against a MOCKED accept envelope (inbox-states.e2e.tsx).
 * Clicks each panel's Accept and screenshots the resulting state.
 */
test("captures inline card + inbox accept states", async ({ page }) => {
  await page.goto("/");

  // --- Inline chat card (the primary surface) ---

  // Pending: the card BEFORE any action — inline Accept / Edit / Discard.
  const cardPending = page.locator('[data-state="card-pending"]');
  await expect(cardPending.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(cardPending.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(cardPending.getByRole("button", { name: "Discard" })).toBeVisible();
  await cardPending.screenshot({ path: path.join(shotDir, "card-01-pending.png") });

  // Applied: click Accept in place → "Applied." + View item (the only navigation).
  const cardApplied = page.locator('[data-state="card-applied"]');
  await cardApplied.getByRole("button", { name: "Accept" }).click();
  await expect(cardApplied.getByText("Applied.")).toBeVisible();
  await expect(cardApplied.getByRole("button", { name: /View item/ })).toBeVisible();
  await cardApplied.screenshot({ path: path.join(shotDir, "card-02-applied.png") });

  // Needs attention (terminal, retryable:false): Discard ONLY — no dead Retry/Edit.
  const cardNeeds = page.locator('[data-state="card-needs-attention"]');
  await cardNeeds.getByRole("button", { name: "Accept" }).click();
  await expect(cardNeeds.getByText("Couldn’t apply this proposal")).toBeVisible();
  await expect(cardNeeds.getByText("The team this refers to no longer exists.")).toBeVisible();
  await expect(cardNeeds.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(cardNeeds.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(cardNeeds.getByRole("button", { name: "Discard" })).toBeVisible();
  await cardNeeds.screenshot({ path: path.join(shotDir, "card-03-needs-attention.png") });

  // This item changed (stale): Refresh / Discard / Apply anyway, in place.
  const cardChanged = page.locator('[data-state="card-changed"]');
  await cardChanged.getByRole("button", { name: "Accept" }).click();
  await expect(cardChanged.getByText("This item changed", { exact: true })).toBeVisible();
  await expect(
    cardChanged.getByText("Someone moved this item to Done since the agent proposed it."),
  ).toBeVisible();
  await expect(cardChanged.getByRole("button", { name: "Apply anyway" })).toBeVisible();
  await cardChanged.screenshot({ path: path.join(shotDir, "card-04-item-changed.png") });

  // --- Review Inbox (batch view) ---

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
  await expect(
    changed.getByText("Someone moved this item to Done since the agent proposed it."),
  ).toBeVisible();
  await expect(changed.getByRole("button", { name: "Apply anyway" })).toBeVisible();
  await changed.screenshot({ path: path.join(shotDir, "03-item-changed.png") });

  await page.screenshot({ path: path.join(shotDir, "00-all-states.png"), fullPage: true });
});
