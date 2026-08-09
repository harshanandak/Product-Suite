import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const inventoryDocPath = join(
  rootDir,
  "docs",
  "architecture",
  "schema-domain-ownership.md",
);
const rootReadmePath = join(rootDir, "README.md");
const serviceInventoryPath = join(
  rootDir,
  "docs",
  "deployment",
  "SERVICE_INVENTORY.md",
);

describe("schema domain inventory", () => {
  test("durable ownership inventory doc records the current authority contract", () => {
    expect(existsSync(inventoryDocPath)).toBe(true);

    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain("# Schema and domain ownership");
    expect(inventoryDoc).toContain("## Current authority (2026-08-09)");
    expect(inventoryDoc).toContain("## Ownership Matrix");
    expect(inventoryDoc).toContain("## Historical evidence (not current authority)");
    expect(inventoryDoc).toContain("## Overlap Notes");
    expect(inventoryDoc).toContain("## Non-Goals");
  });

  test("current domain entities are mapped to the Neon schema model", () => {
    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain(
      "| Workboard, teams, projects, statuses, work items | Platform API | Neon `neondb` | `packages/db/src/schema.ts` |",
    );
    expect(inventoryDoc).toContain(
      "| Meetings, transcripts, summaries, jobs, meeting links | Platform/Meeting services | Neon `neondb` | `packages/db/src/meeting-schema.ts` re-exported by `schema.ts` |",
    );
    expect(inventoryDoc).toContain(
      "| Agent runs, proposals, memories, knowledge | Platform API / agent module | Neon `neondb` | `packages/db/src/schema.ts` |",
    );
    expect(inventoryDoc).toContain(
      "| Realtime transport | Hocuspocus service | Neon `neondb` when persisted by Product Suite | service-owned tables in `public` |",
    );
  });

  test("meeting ownership and historical migration provenance are documented", () => {
    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain(
      "[`apps/meeting-api/backend/alembic/versions`](../../apps/meeting-api/backend/alembic/versions)",
    );
    expect(inventoryDoc).toContain(
      "[`apps/meeting-api/backend/migrations`](../../apps/meeting-api/backend/migrations)",
    );
    expect(inventoryDoc).toContain("historical_non_authoritative");
    expect(inventoryDoc).toContain(
      "The five-block bootstrap repair in Drizzle `0000`/`0004` is immutable",
    );
  });

  test("historical provider and compatibility roots cannot become current authority", () => {
    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain(
      "[`infra/supabase/migrations`](../../infra/supabase/migrations)",
    );
    expect(inventoryDoc).toContain(
      "[`apps/roadmap-web/supabase/migrations`](../../apps/roadmap-web/supabase/migrations)",
    );
    expect(inventoryDoc).toContain("not current authority");
    expect(inventoryDoc).toContain("not a pending journal");
  });

  test("shared-entity collision rules are explicit", () => {
    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");
    const normalizedDoc = inventoryDoc.replace(/\s+/g, " ");

    expect(normalizedDoc).toContain("### users and identity");
    expect(normalizedDoc).toContain(
      "Identity and authorization remain application concerns; database rows use internal Product Suite user IDs.",
    );
    expect(normalizedDoc).toContain(
      "Meeting conversation stays scoped to meeting records and their evidence.",
    );
    expect(normalizedDoc).toContain(
      "Workboard and canvas artifacts stay in the shared Neon model, while transcript and summary artifacts stay in the meeting domain.",
    );
    expect(normalizedDoc).toContain("## Contract boundary");
  });

  test("inventory doc is discoverable from durable root-facing docs", () => {
    const rootReadme = readFileSync(rootReadmePath, "utf8");
    const serviceInventory = readFileSync(serviceInventoryPath, "utf8");

    expect(rootReadme).toContain(
      "docs/architecture/schema-domain-ownership.md",
    );
    expect(serviceInventory).toContain(
      "../architecture/schema-domain-ownership.md",
    );
  });
});
