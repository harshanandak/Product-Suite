import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

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
 *  - "Review in Inbox" proposal link ... src/agent-chat/ProposalCard.tsx
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

test.beforeEach(async ({ page }) => {
  // Inject the Clerk testing token on every test so bot-protection never trips,
  // even though storageState already carries the session.
  await setupClerkTestingToken({ page });
});

test("agent proposes a create → accept in inbox → item appears on the workboard", async ({
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
  // On success the panel renders a ProposalCard with a "Review in Inbox" link.
  // VERIFY against live app: exact wording + how long the agent takes to emit
  // a proposal tool-call.
  await expect(
    agentPanel.getByRole("link", { name: /Review in Inbox/i }),
  ).toBeVisible({ timeout: AGENT_TIMEOUT });

  // ── d. Review Inbox shows the proposed create ─────────────────────────────
  await page.goto(`/w/${WORKSPACE}/inbox`);
  const pendingList = page.getByRole("list", { name: "Pending proposals" });
  await expect(pendingList).toBeVisible({ timeout: AGENT_TIMEOUT });

  // Select the new proposal from the list. VERIFY against live app:
  // ProposalListItem's accessible name — it surfaces the item title, so we open
  // the list entry that mentions our title.
  await pendingList.getByText(ITEM_TITLE, { exact: false }).first().click();

  // The detail pane's diff must show the proposed create (the new title).
  // VERIFY against live app: exact diff DOM (field-diff rows). Asserting the
  // proposed title is visible in the detail region is the load-bearing check.
  const acceptButton = page.getByRole("button", { name: "Accept" });
  await expect(acceptButton).toBeVisible();
  await expect(page.getByText(ITEM_TITLE, { exact: false }).first()).toBeVisible();

  // ── e. Accept the proposal ────────────────────────────────────────────────
  await acceptButton.click();
  // On a successful applied write the detail shows a "View item →" link.
  await expect(page.getByRole("link", { name: /View item/i })).toBeVisible({
    timeout: AGENT_TIMEOUT,
  });

  // ── f. The validated write applied: item is now on the workboard ──────────
  await page.goto(`/w/${WORKSPACE}/workboard`);
  await expect(async () => {
    await expect(page.getByText(ITEM_TITLE, { exact: false }).first()).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: AGENT_TIMEOUT });
});
