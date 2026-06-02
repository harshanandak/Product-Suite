import { describe, expect, test } from "bun:test";

import { analyzeSupabaseExposure } from "../scripts/check-supabase-exposure.mjs";

describe("check-supabase-exposure", () => {
  test("flags exposed-schema tables that do not enable RLS", () => {
    const issues = analyzeSupabaseExposure(`
      create table if not exists public.leaky_table (
        id uuid primary key
      );
      grant select on public.leaky_table to authenticated;
    `);

    expect(issues).toContain(
      "public.leaky_table is in an exposed schema but does not enable row level security",
    );
  });

  test("allows private platform tables with explicit private-schema revokes", () => {
    const issues = analyzeSupabaseExposure(`
      create schema if not exists platform;
      revoke all on schema platform from public, anon, authenticated;
      create table if not exists platform.users (
        id uuid primary key
      );
      alter table platform.users enable row level security;
    `);

    expect(issues).toEqual([]);
  });
});
