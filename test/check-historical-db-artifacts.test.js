import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALLOWED_REPAIRS,
  checkHistoricalArtifacts,
  detectHistoryVariant,
  inspectRepairSemantics,
  normalizeLineEndings,
  sha256,
} from "../scripts/check-historical-db-artifacts.mjs";

const repoRoot = join(import.meta.dir, "..");
const migrationRoot = join(repoRoot, "packages", "db", "migrations");
const bootstrapFixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "db-history", "bootstrap-probe.json"), "utf8"));
const untouchedFixture = readFileSync(join(import.meta.dir, "fixtures", "db-history", "untouched-0000.sql"), "utf8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "docs", "history", "database-migrations", "manifest.json"), "utf8"));
const retiredMeetingMigrationSurfaces = [
  "apps/meeting-api/backend/alembic.ini",
  "apps/meeting-api/backend/alembic/env.py",
  "apps/meeting-api/backend/alembic/url_config.py",
  "apps/meeting-api/backend/alembic/__tests__/env.test.py",
  "apps/meeting-api/backend/alembic/__tests__/url_config.test.py",
  "apps/meeting-api/backend/migrate.py",
].map((relativePath) => join(repoRoot, relativePath));
const canonicalMeetingDocs = [
  "apps/meeting-api/README.md",
  "apps/meeting-api/docs/deployment/HOSTED_FOUNDATION.md",
  "apps/meeting-api/docs/deployment/PRODUCTION_HOSTED_LAUNCH_CHECKLIST.md",
].map((relativePath) => join(repoRoot, relativePath));

function readMigration(name) {
  return readFileSync(join(migrationRoot, name), "utf8");
}

describe("historical database artifacts", () => {
  test("keeps the empty-bootstrap RED contract explicit when live PostgreSQL is unavailable", () => {
    expect(bootstrapFixture.untouchedRed).toEqual({ stopAfter: "0000_stale_jamie_braddock", sqlState: "42P01", relation: "public.tenants" });
    expect(bootstrapFixture.repair.allowedGuardCount).toBe(5);
    expect(bootstrapFixture.liveProbe).toBe("INCOMPLETE_WHEN_POSTGRESQL_17_UNAVAILABLE");
    expect(untouchedFixture).not.toMatch(/to_regclass/i);
    expect(untouchedFixture).toMatch(/REFERENCES\s+"public"\."tenants"/i);
  });

  test("manifests all four historical roots without becoming a second journal", () => {
    expect(Object.keys(manifest.historicalRoots)).toEqual([
      "infra/supabase/migrations",
      "apps/roadmap-web/supabase/migrations",
      "apps/meeting-api/backend/alembic/versions",
      "apps/meeting-api/backend/migrations",
    ]);
    expect(manifest.policy.manifestRole).toBe("validation-only");
    expect(manifest.policy.drizzleImmutable).toHaveLength(17);
    expect(Object.values(manifest.historicalRoots).reduce((count, root) => count + root.files.length, 0)).toBe(108);
  });

  test("names exactly the five permitted bootstrap FK repairs", () => {
    expect(ALLOWED_REPAIRS).toHaveLength(5);
    expect(ALLOWED_REPAIRS.map(({ file, constraint }) => `${file}:${constraint}`)).toEqual([
      "0000_stale_jamie_braddock.sql:projects_tenant_id_tenants_id_fk",
      "0000_stale_jamie_braddock.sql:work_items_tenant_id_tenants_id_fk",
      "0000_stale_jamie_braddock.sql:work_item_dependencies_tenant_id_tenants_id_fk",
      "0000_stale_jamie_braddock.sql:work_items_assignee_id_users_id_fk",
      "0004_minor_lockheed.sql:projects_lead_id_users_id_fk",
    ]);
  });

  test("repaired files guard only when the referenced relation is present", () => {
    const zero = readMigration("0000_stale_jamie_braddock.sql");
    const four = readMigration("0004_minor_lockheed.sql");
    expect(inspectRepairSemantics(zero, "0000_stale_jamie_braddock.sql")).toMatchObject({ ok: true, repairCount: 4 });
    expect(inspectRepairSemantics(four, "0004_minor_lockheed.sql")).toMatchObject({ ok: true, repairCount: 1 });
    expect(zero).toMatch(/IF\s+to_regclass\(['"]public\.tenants['"]\)\s+IS\s+NOT\s+NULL/i);
    expect(zero).toMatch(/IF\s+to_regclass\(['"]public\.users['"]\)\s+IS\s+NOT\s+NULL/i);
    expect(four).toMatch(/IF\s+to_regclass\(['"]public\.users['"]\)\s+IS\s+NOT\s+NULL/i);
  });

  test("preserves exact FK names, columns, referenced columns, and actions", () => {
    const result = inspectRepairSemantics(readMigration("0000_stale_jamie_braddock.sql"), "0000_stale_jamie_braddock.sql");
    expect(result.ok).toBe(true);
    expect(result.semanticViolations).toEqual([]);
    expect(inspectRepairSemantics(readMigration("0004_minor_lockheed.sql"), "0004_minor_lockheed.sql").semanticViolations).toEqual([]);
  });

  test("rejects a sixth edit or a changed FK action", () => {
    const altered = readMigration("0000_stale_jamie_braddock.sql").replace(
      '"projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade',
      '"projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict',
    );
    const result = inspectRepairSemantics(altered, "0000_stale_jamie_braddock.sql");
    expect(result.ok).toBe(false);
    expect(result.semanticViolations.some((issue) => issue.includes("semantics changed"))).toBe(true);
    const extraGuard = `${readMigration("0004_minor_lockheed.sql")}\nDO $$ BEGIN IF to_regclass('public.projects') IS NOT NULL THEN PERFORM 1; END IF; END $$;`;
    expect(inspectRepairSemantics(extraGuard, "0004_minor_lockheed.sql").ok).toBe(false);
  });

  test("normalizes LF and CRLF without treating line endings as semantic drift", () => {
    const source = "a\r\nb\r\n";
    expect(normalizeLineEndings(source)).toBe("a\nb\n");
    expect(sha256(source)).toBe(sha256("a\nb\n"));
  });

  test("accepts complete original-production and repaired-bootstrap prefixes", () => {
    expect(detectHistoryVariant({ "0000_stale_jamie_braddock.sql": "original", "0004_minor_lockheed.sql": "original" })).toBe("original-production");
    expect(detectHistoryVariant({ "0000_stale_jamie_braddock.sql": "repaired", "0004_minor_lockheed.sql": "repaired" })).toBe("repaired-bootstrap");
  });

  test("rejects mixed, unknown, and fabricated snapshots", () => {
    expect(() => detectHistoryVariant({ "0000_stale_jamie_braddock.sql": "original", "0004_minor_lockheed.sql": "repaired" })).toThrow(/mixed/i);
    expect(() => detectHistoryVariant({ "0000_stale_jamie_braddock.sql": "fabricated", "0004_minor_lockheed.sql": "fabricated" })).toThrow(/unknown|fabricated/i);
    expect(() => detectHistoryVariant({ "0000_stale_jamie_braddock.sql": "original", "0004_minor_lockheed.sql": "original", snapshot: { id: "not-a-journal-snapshot" } })).toThrow(/snapshot/i);
  });

  test("retires executable Meeting migration surfaces while preserving manifest-verified history", () => {
    expect(retiredMeetingMigrationSurfaces.filter(existsSync)).toEqual([]);
    expect(checkHistoricalArtifacts({ root: repoRoot })).toMatchObject({ ok: true });

    const meetingRequirements = readFileSync(join(repoRoot, "apps/meeting-api/backend/requirements.txt"), "utf8");
    const toolchain = readFileSync(join(repoRoot, "apps/meeting-api/docs/forge/TOOLCHAIN.md"), "utf8");
    expect(meetingRequirements).not.toMatch(/^alembic\s*=/im);
    expect(toolchain).toMatch(/Drizzle|packages[\\/]db[\\/]migrations/i);
    expect(toolchain).not.toMatch(/\bAlembic\b|python\s+(?:-m\s+)?migrate\.py/i);

    for (const docPath of canonicalMeetingDocs) {
      const content = readFileSync(docPath, "utf8");
      expect(content).toMatch(/Neon/i);
      expect(content).toMatch(/Drizzle|packages[\\/]db[\\/]migrations/i);
      expect(content).not.toMatch(/alembic(?:\s+(?:upgrade|revision))|python\s+(?:-m\s+)?migrate\.py|schema_migrations/i);
    }
  });
});
