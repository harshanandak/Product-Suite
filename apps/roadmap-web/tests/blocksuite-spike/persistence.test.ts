import { describe, expect, test } from "bun:test";

import fixtureMetadata from "./fixtures/affine-0.19.5-space-doc.json";
import { hashFixture, restoreFixture, semanticSnapshot } from "./fixture";

describe("BlockSuite 0.19.5 spaceDoc persistence", () => {
  test("restores the frozen public-API fixture with stable semantics", async () => {
    const restored = await restoreFixture();

    expect(await hashFixture()).toBe(fixtureMetadata.sha256);
    expect(restored.id).toBe(fixtureMetadata.documentId);
    expect(semanticSnapshot(restored)).toEqual(fixtureMetadata.snapshot);
  });
});
