import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { readWorkItemAppliedFrom } from "./db-provenance.e2e";

/**
 * THE MOAT LOOP — end-to-end proof that:
 *   agent proposes → Review Inbox → accept → validated write applies.
 *
 * This is the #1 launch-gate spec. It drives the REAL UI against a REAL backend
 * (Clerk auth + Neon DB + OpenRouter agent). It cannot pass without live
 * secrets (see e2e/README.md) — it is correct-by-construction against the
 * current components, and every selector below is a real role/aria/text pulled
 * from source. A few selectors and the agent-latency timing genuinely depend on
 * the running app; those carry a `// VERIFY against live app` note.
 *
 * Selector provenance (source of truth):
 *  - TopBar "Ask agent" button ......... src/shell/TopBar.tsx
 *  - Agent chat panel <aside> .......... src/agent-chat/AgentChatPanel.tsx (aria-label="Agent chat")
 *  - Composer submit ................... packages/ui-chat/.../prompt-input.tsx (aria-label="Submit")
 *  - Proposal card + "Edit" action ...... src/agent-chat/ProposalCard.tsx
 *  - Inbox pending list ................ src/boards/inbox/InboxScreen.tsx (aria-label="Pending proposals")
 *  - Accept / "View item →" ............ src/boards/inbox/ProposalDetail.tsx
 *  - Workboard empty state ............. src/boards/workboard/WorkboardScreen.tsx ("No work items yet")
 *  - Routes ............................ src/router.tsx (/w/$workspace/{workboard,inbox,review})
 */

const WORKSPACE = process.env.E2E_WORKSPACE ?? "befach-hq";
// Unique per run: the agent reads the board first and (correctly) refuses to
// create a DUPLICATE title, so a fixed title only works on the very first run
// against a given tenant. A unique suffix keeps every run a genuine create.
const ITEM_TITLE = `E2E smoke test item ${Date.now()}`;
const AGENT_PROMPT = `Create a work item titled '${ITEM_TITLE}' in this team`;

// A real agent + LLM round-trip is slow; give the propose/apply steps headroom.
const AGENT_TIMEOUT = 90_000;

const clerkPublishableKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim();
const missingLivePrerequisites = [
  process.env.CLERK_SECRET_KEY?.trim() ? null : "CLERK_SECRET_KEY",
  clerkPublishableKey
    ? null
    : "publishable key (VITE_CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY)",
  process.env.E2E_CLERK_USER?.trim() ? null : "E2E_CLERK_USER",
  process.env.DATABASE_URL?.trim() ? null : "DATABASE_URL",
].filter((name): name is string => name !== null);

test.skip(
  missingLivePrerequisites.length > 0,
  `INCOMPLETE: missing live prerequisites: ${missingLivePrerequisites.join(", ")}`,
);

test.beforeEach(async ({ page }) => {
  // Inject the Clerk testing token on every test so bot-protection never trips,
  // even though storageState already carries the session.
  await setupClerkTestingToken({ page });
});

test("agent proposes a create → accept in inbox → provenance appears on item detail", async ({
  page,
}) => {
  // ── a. Workboard loads ────────────────────────────────────────────────────
  await page.goto(`/w/${WORKSPACE}/workboard`);
  // The board is "loaded" when either the data grid renders (WorkboardTable
  // exposes role="grid" aria-label="Work items") OR the teaching empty state shows.
  const boardTable = page.getByRole("grid", { name: "Work items" });
  const boardEmpty = page.getByRole("heading", { name: "No work items yet" });
  await expect(boardTable.or(boardEmpty).first()).toBeVisible();

  // ── b. Open the agent chat and send a concrete create prompt ──────────────
  await page.getByRole("button", { name: "Ask agent" }).click();
  const agentPanel = page.getByRole("complementary", { name: "Agent chat" });
  await expect(agentPanel).toBeVisible();

  // The ui-chat composer renders a textarea; target it by its placeholder so the
  // threads drawer's controls can never shadow it.
  const composer = agentPanel.getByPlaceholder(
    "Ask the agent to read the board or propose a change…",
  );
  await composer.fill(AGENT_PROMPT);
  // The composer's submit control (PromptInputSubmit) is an icon-only button with
  // no accessible "Submit" name — submit by pressing Enter in the textarea.
  await composer.press("Enter");

  // ── c. Wait for the agent to PROPOSE ──────────────────────────────────────
  // The current ProposalCard reviews inline; its existing Edit action is the
  // route into the full Inbox and carries the authoritative proposal id.
  const proposalCard = agentPanel
    .locator('[id^="proposal-card-"]')
    .filter({ hasText: ITEM_TITLE });
  await expect(proposalCard).toBeVisible({ timeout: AGENT_TIMEOUT });
  await proposalCard.getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/inbox\?proposal=/);

  const proposalId = new URL(page.url()).searchParams.get("proposal");
  expect(proposalId, "ProposalCard Edit must carry ?proposal=<id>").toBeTruthy();
  if (!proposalId) return;

  // ── d. Review Inbox shows the proposed create ─────────────────────────────
  const pendingList = page.getByRole("list", { name: "Pending proposals" });
  await expect(pendingList).toBeVisible({ timeout: AGENT_TIMEOUT });
  await expect(pendingList.getByText(ITEM_TITLE, { exact: false }).first()).toBeVisible();

  // The detail pane's diff must show the proposed create (the new title).
  // VERIFY against live app: exact diff DOM (field-diff rows). Asserting the
  // proposed title is visible in the detail region is the load-bearing check.
  const acceptButton = page.getByRole("button", { name: "Accept" });
  await expect(acceptButton).toBeVisible();
  await expect(page.getByText(ITEM_TITLE, { exact: false }).first()).toBeVisible();

  // ── e. Accept the proposal ────────────────────────────────────────────────
  await acceptButton.click();
  // On a successful applied write the detail shows a "View item →" link.
  const viewItemLink = page.getByRole("link", { name: /View item/i });
  await expect(viewItemLink).toBeVisible({
    timeout: AGENT_TIMEOUT,
  });

  // ── f. The write is PERSISTED with full accountable provenance ──────────────
  const persisted = await readWorkItemAppliedFrom(proposalId);
  expect(
    persisted,
    "a work item must be linked to the accepted proposal via applied_from_proposal_id",
  ).toBeTruthy();
  if (!persisted) return;

  expect(persisted.title).toBe(ITEM_TITLE);
  expect(persisted.applied_from_proposal_id).toBe(proposalId);
  expect(persisted.source).toBe("agent");
  expect(persisted.actor_type).toBe("agent");
  expect(persisted.actor_id).toBeTruthy();
  expect(persisted.run_id).toBeTruthy();
  expect(persisted.actor_id).toBe(persisted.run_id);
  expect(persisted.on_behalf_of).toBeTruthy();
  expect(persisted.decided_by).toBe(persisted.on_behalf_of);
  expect(persisted.decided_at).toBeTruthy();

  // ── g. The same item renders the tenant-safe provenance read model ──────────
  await viewItemLink.click();
  await expect(page.getByRole("heading", { name: ITEM_TITLE })).toBeVisible({
    timeout: AGENT_TIMEOUT,
  });

  const provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toBeVisible();
  await expect(provenance.getByText("Agent", { exact: true })).toBeVisible();

  const proposalLink = provenance.getByRole("link", {
    name: `Review proposal ${proposalId} in Inbox`,
  });
  await expect(proposalLink).toBeVisible();
  const proposalHref = await proposalLink.getAttribute("href");
  expect(proposalHref, "detail proposal link must have an href").toBeTruthy();
  if (!proposalHref) return;
  const proposalUrl = new URL(proposalHref, page.url());
  expect(proposalUrl.pathname).toBe(`/w/${WORKSPACE}/inbox`);
  expect(proposalUrl.searchParams.get("proposal")).toBe(proposalId);
});
