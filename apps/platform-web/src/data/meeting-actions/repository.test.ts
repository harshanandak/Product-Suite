import { describe, expect, it } from "vitest";

import { createMeetingActionFixtures } from "./fixtures";
import { createMockMeetingActionsRepository } from "./repository";

describe("createMockMeetingActionsRepository", () => {
  it("lists the fixture candidates", async () => {
    const candidates = await createMockMeetingActionsRepository().list();
    expect(candidates).toEqual(createMeetingActionFixtures());
  });

  it("does not share mutations across instances", async () => {
    const first = await createMockMeetingActionsRepository().list();
    first[0]!.text = "mutated";
    const [candidate] = await createMockMeetingActionsRepository().list();
    expect(candidate?.text).not.toBe("mutated");
  });

  it("does not share mutations between reads of the SAME instance", async () => {
    // The screen holds the array it was handed; mutating it must not rewrite the
    // store beneath a later refetch.
    const repository = createMockMeetingActionsRepository();
    const first = await repository.list();
    first[0]!.text = "mutated";
    expect((await repository.list())[0]?.text).not.toBe("mutated");
  });

  it("sync proposes the unpromoted candidates, and reports how many", async () => {
    const repository = createMockMeetingActionsRepository();
    const unpromotedBefore = (await repository.list()).filter(
      (c) => c.promotion_state === "unpromoted",
    );
    expect(unpromotedBefore.length).toBeGreaterThan(0);

    const summary = await repository.sync();
    expect(summary.proposalsCreated).toBe(unpromotedBefore.length);

    const after = await repository.list();
    for (const candidate of unpromotedBefore) {
      const synced = after.find((c) => c.id === candidate.id);
      expect(synced?.promotion_state).toBe("proposal_pending");
      // It must carry a proposal id, or the screen has no Inbox link to offer.
      expect(synced?.proposal_id).toBeTruthy();
    }
  });

  it("sync is idempotent — a second run proposes nothing and skips the duplicates", async () => {
    const repository = createMockMeetingActionsRepository();
    const first = await repository.sync();

    const second = await repository.sync();
    expect(second.proposalsCreated).toBe(0);
    expect(second.skippedDuplicate).toBe(first.proposalsCreated);
  });

  it("sync leaves the states it has no business touching alone", async () => {
    const repository = createMockMeetingActionsRepository();
    const before = new Map(
      (await repository.list()).map((c) => [c.id, c.promotion_state]),
    );

    await repository.sync();

    for (const candidate of await repository.list()) {
      if (before.get(candidate.id) === "unpromoted") continue;
      // An accepted or dismissed candidate has been decided; re-proposing it
      // would reopen a question the human already answered.
      expect(candidate.promotion_state).toBe(before.get(candidate.id));
    }
  });
});
