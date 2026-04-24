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

describe("schema domain inventory", () => {
  test("durable ownership inventory doc exists with required task-one sections", () => {
    expect(existsSync(inventoryDocPath)).toBe(true);

    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain("# Schema And Domain Ownership");
    expect(inventoryDoc).toContain("## Ownership Matrix");
    expect(inventoryDoc).toContain("## Overlap Notes");
    expect(inventoryDoc).toContain("## Non-Goals");
  });

  test("roadmap-owned entities are mapped with canonical schema paths", () => {
    const inventoryDoc = readFileSync(inventoryDocPath, "utf8");

    expect(inventoryDoc).toContain(
      "| `team` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` |",
    );
    expect(inventoryDoc).toContain(
      "| `workspace` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` |",
    );
    expect(inventoryDoc).toContain(
      "| `thread` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/src/lib/supabase/types.ts` |",
    );
    expect(inventoryDoc).toContain(
      "| `task` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` |",
    );
  });
});
