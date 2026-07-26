import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  cleanupMeetingCandidate,
  readMeetingIngestCounts,
  readMeetingWorkItem,
  seedMeetingCandidate,
  type SeededMeetingCandidate,
} from "./db-provenance.e2e";

/**
 * THE MEETING LOOP — end-to-end proof that:
 *   a promoted meeting action item → "Sync now" → Review Inbox → accept → workboard,
 *   and that a SECOND sync proposes nothing.
 *
 * This is the definition of done for the meeting MVP. Like `moat-loop.spec.ts` it
 * drives the REAL UI against a REAL backend (Clerk auth + Neon), and it cannot pass
 * without live secrets (see e2e/README.md).
 *
 * The one thing it fakes is the meeting itself: `seedMeetingCandidate` writes the
 * promoted `public.action_items` row that a real transcript extraction would have
 * produced, because meeting-api — not the platform — owns that write. Everything
 * downstream of that row is the real path: the real ingest endpoint behind the real
 * button, the real review queue, the real accept-time validated write.
 *
 * Selector provenance (source of truth):
 *  - "Sync now" button ................. src/boards/meetings/MeetingTriageScreen.tsx
 *  - Candidate list <ul> ............... MeetingTriageScreen.tsx (aria-label="Meeting action items")
 *  - "Not proposed" / "Proposal pending" / "Accepted" badges ... PROMOTION_STATE_BADGES, ibid.
 *  - "Review in Inbox →" link .......... MeetingTriageScreen.tsx (CandidateLink)
 *  - Inbox pending list ................ src/boards/inbox/InboxScreen.tsx (aria-label="Pending proposals")
 *  - Accept / "View item →" ............ src/boards/inbox/ProposalDetail.tsx
 *  - Workboard grid / empty state ...... src/boards/workboard/WorkboardScreen.tsx
 *  - Routes ............................ src/router.tsx (/w/$workspace/{meetings/triage,inbox,workboard})
 */

const WORKSPACE = process.env.E2E_WORKSPACE ?? "befach-hq";

/**
 * The tenant to seed for. It MUST be a key of the API's `MEETING_TENANT_MAP` — the
 * ingest's allowlist is fail-closed, so an unlisted tenant makes the loop propose
 * nothing and the failure would look like a bug rather than a config gap. Kept in
 * env (never hardcoded) precisely so both sides are configured together.
 */
const MEETING_TENANT_ID = process.env.E2E_MEETING_TENANT_ID ?? "";

// Unique per run, the `Date.now()` pattern `moat-loop.spec.ts` uses: accepting the
// proposal creates a work item, and a fixed title would collide with the previous
// run's row on the board (and make "is it visible?" ambiguous).
const ITEM_TEXT = `E2E meeting action item ${Date.now()}`;

// The ingest is a handful of SQL round-trips, not an LLM call, so this is far
// shorter than the moat loop's agent budget — but still generous: it crosses the
// Vite proxy to a cold wrangler worker on the first request.
const LOOP_TIMEOUT = 60_000;

/**
 * Module-scoped so `afterEach` can clean up even when the test fails mid-way. A
 * spec that seeds a SHARED database and cleans up only on the happy path leaves
 * debris behind exactly when someone is already debugging.
 */
let seeded: SeededMeetingCandidate | undefined;

test.beforeEach(async ({ page }) => {
  // Inject the Clerk testing token on every test so bot-protection never trips,
  // even though storageState already carries the session.
  await setupClerkTestingToken({ page });
});

test.afterEach(async () => {
  if (seeded === undefined) return;
  await cleanupMeetingCandidate({ tenantId: MEETING_TENANT_ID, ...seeded });
  seeded = undefined;
});

test("promoted meeting action item → sync → inbox → accept → workboard, exactly once", async ({
  page,
}) => {
  // Unlike the moat loop's DB assertions, the seed is not optional: without a
  // database there is no meeting row to ingest, so the whole spec skips rather than
  // passing vacuously.
  test.skip(
    !process.env.DATABASE_URL || MEETING_TENANT_ID === "",
    "DATABASE_URL and E2E_MEETING_TENANT_ID are required to seed the meeting candidate.",
  );

  // ── a. Seed the promoted meeting action item ───────────────────────────────
  seeded = await seedMeetingCandidate({
    tenantId: MEETING_TENANT_ID,
    text: ITEM_TEXT,
  });
  expect(seeded, "the meeting candidate seed must succeed").toBeDefined();
  const { recordId } = seeded as SeededMeetingCandidate;

  // ── b. The triage screen shows it, not yet proposed ────────────────────────
  await page.goto(`/w/${WORKSPACE}/meetings/triage`);
  const candidateList = page.getByRole("list", { name: "Meeting action items" });
  await expect(candidateList).toBeVisible({ timeout: LOOP_TIMEOUT });

  const candidateRow = candidateList.getByRole("listitem").filter({ hasText: ITEM_TEXT });
  await expect(candidateRow).toHaveCount(1);
  await expect(candidateRow.getByText("Not proposed")).toBeVisible();

  // ── c. "Sync now" runs the real ingest ────────────────────────────────────
  const syncButton = page.getByRole("button", { name: /Sync now/i });
  await syncButton.click();

  // The row flips to "Proposal pending" once the list refetches — the ingest minted
  // a proposal and wrote its ledger row.
  await expect(candidateRow.getByText("Proposal pending")).toBeVisible({
    timeout: LOOP_TIMEOUT,
  });

  // The deep-link carries the proposal id, so the DB assertions below can pin the
  // provenance pointer to THIS proposal rather than to whatever is newest.
  const inboxLink = candidateRow.getByRole("link", { name: /Review in Inbox/i });
  const inboxHref = await inboxLink.getAttribute("href");
  const proposalId = inboxHref
    ? new URL(inboxHref, page.url()).searchParams.get("proposal")
    : null;
  expect(
    proposalId,
    "the pending candidate's Inbox link must carry ?proposal=<id>",
  ).toBeTruthy();

  // Exactly one proposal and one ledger row, before any second sync.
  const afterFirstSync = await readMeetingIngestCounts({
    tenantId: MEETING_TENANT_ID,
    recordId,
  });
  expect(afterFirstSync).toEqual({ proposals: 1, ledgerRows: 1 });

  // ── d. The proposal is in the Review Inbox ────────────────────────────────
  await inboxLink.click();
  const pendingList = page.getByRole("list", { name: "Pending proposals" });
  await expect(pendingList).toBeVisible({ timeout: LOOP_TIMEOUT });
  // The deep-link preselects it, so the detail pane already shows the candidate
  // text as the proposed work-item title (`payload.title` = the action item's text).
  await expect(
    pendingList.getByText(ITEM_TEXT, { exact: false }).first(),
    "the seeded action item must appear in the pending list",
  ).toBeVisible();

  const acceptButton = page.getByRole("button", { name: "Accept" });
  await expect(acceptButton).toBeVisible();

  // ── e. Accept it ──────────────────────────────────────────────────────────
  await acceptButton.click();
  await expect(page.getByRole("link", { name: /View item/i })).toBeVisible({
    timeout: LOOP_TIMEOUT,
  });

  // ── f. The validated write applied: the item is on the workboard ──────────
  await page.goto(`/w/${WORKSPACE}/workboard`);
  await expect(async () => {
    await expect(page.getByText(ITEM_TEXT, { exact: false }).first()).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: LOOP_TIMEOUT });

  // ── g. Persisted provenance, read straight from Neon ──────────────────────
  // Two claims, not one: the item is linked to the proposal we accepted, AND it
  // records that a MEETING is where it came from. The link alone would be satisfied
  // by any accepted proposal; `source` is what makes the meeting loop traceable.
  const persisted = await readMeetingWorkItem(proposalId as string);
  expect(
    persisted,
    "a work item must be linked to the accepted proposal via applied_from_proposal_id",
  ).not.toBeNull();
  expect(persisted?.title).toBe(ITEM_TEXT);
  expect(persisted?.source, "the applied work item must carry meeting provenance").toBe(
    "meeting",
  );

  // ── h. Idempotence: a second sync proposes nothing ────────────────────────
  // The ledger, proven end-to-end. The row is unchanged, so the only thing stopping
  // a duplicate proposal is `meeting_promotions` — and this is the one place that is
  // exercised through the real endpoint rather than a unit-test seam.
  await page.goto(`/w/${WORKSPACE}/meetings/triage`);
  await expect(candidateList).toBeVisible({ timeout: LOOP_TIMEOUT });
  await expect(candidateRow.getByText("Accepted")).toBeVisible();

  await page.getByRole("button", { name: /Sync now/i }).click();
  // Wait for the sync to finish (the button leaves its in-flight label) so the
  // counts below are read AFTER the second ingest, not racing it.
  await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled({
    timeout: LOOP_TIMEOUT,
  });
  await expect(
    page.getByRole("alert"),
    "the second sync must not error",
  ).toHaveCount(0);

  const afterSecondSync = await readMeetingIngestCounts({
    tenantId: MEETING_TENANT_ID,
    recordId,
  });
  expect(
    afterSecondSync,
    "a second ingest of an unchanged candidate must add no second proposal",
  ).toEqual({ proposals: 1, ledgerRows: 1 });

  // The board must not have grown a duplicate either.
  await page.goto(`/w/${WORKSPACE}/workboard`);
  await expect(page.getByText(ITEM_TEXT, { exact: false })).toHaveCount(1);

  // ── i. Cleanup runs in afterEach, so a failure above still leaves no debris ──
});
