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
});
