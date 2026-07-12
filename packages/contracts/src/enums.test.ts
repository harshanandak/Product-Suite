import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import * as enumsModule from "./enums.js";
import { enums } from "./enums.js";

/**
 * Tri-directional drift guard (Fable-flagged). The domain enums exist in THREE
 * independent artifacts that must never disagree:
 *   1. the JS runtime  (`enums.js`)          — what code executes,
 *   2. the JSON mirror (`../contracts/enums.json`) — the language-neutral source,
 *   3. the TS union types (`index.d.ts`)       — what TypeScript consumers see.
 *
 * These tests derive the value sets from EACH artifact independently (the JSON
 * is parsed from disk; the union members are extracted from the raw `.d.ts`
 * TEXT, not from a TS type — so they can actually disagree) and assert equality.
 * If someone adds `"archived"` to the JS array but forgets the union or the
 * JSON, this fails. It is not a tautology because no artifact is derived from
 * another at test time.
 */

const enumsJson = JSON.parse(
  readFileSync(new URL("../contracts/enums.json", import.meta.url), "utf8"),
) as Record<string, { values: string[]; labels: Record<string, string>; order: string[] }>;

const dtsText = readFileSync(new URL("./index.d.ts", import.meta.url), "utf8");

/** Extract the string-literal members of `export type <Name> = "a" | "b";`. */
function unionMembers(typeName: string): string[] {
  const match = new RegExp(
    `export type ${typeName} =([^;]+);`,
  ).exec(dtsText);
  if (!match) {
    throw new Error(`Union type '${typeName}' not found in index.d.ts`);
  }
  const members = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`Union type '${typeName}' has no string-literal members`);
  }
  return members;
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

// enum key in enums.json → its union type name in index.d.ts
const CASES: ReadonlyArray<{ key: string; unionType: string }> = [
  { key: "phase", unionType: "Phase" },
  { key: "checkStatus", unionType: "CheckStatus" },
  { key: "health", unionType: "Health" },
  { key: "priority", unionType: "Priority" },
  { key: "workItemType", unionType: "WorkItemType" },
  { key: "workItemSource", unionType: "WorkItemSource" },
];

describe("@product-suite/contracts enums — tri-directional sync", () => {
  test("the JS `enums` object deep-equals contracts/enums.json", () => {
    expect(enums).toEqual(enumsJson);
  });

  test.each(CASES)("$key: JS values, .d.ts union, and JSON agree", ({ key, unionType }) => {
    const jsValues = enums[key as keyof typeof enums] as unknown as {
      values: string[];
    };
    const jsonValues = enumsJson[key].values;
    const tsMembers = unionMembers(unionType);

    // All three as SETS (order asserted separately below).
    expect(sorted(jsValues.values)).toEqual(sorted(jsonValues));
    expect(sorted(tsMembers)).toEqual(sorted(jsValues.values));
    expect(sorted(tsMembers)).toEqual(sorted(jsonValues));
  });

  test.each(CASES)("$key: label keys and order cover exactly the value set", ({ key }) => {
    const descriptor = enumsJson[key];
    expect(sorted(Object.keys(descriptor.labels))).toEqual(sorted(descriptor.values));
    expect(sorted(descriptor.order)).toEqual(sorted(descriptor.values));
    // Every label is a non-empty string.
    for (const label of Object.values(descriptor.labels)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("named exports match the canonical `enums` object", () => {
    expect(enumsModule.PHASE_VALUES).toEqual(enums.phase.values);
    expect(enumsModule.PHASE_LABELS).toEqual(enums.phase.labels);
    expect(enumsModule.PHASE_ORDER).toEqual(enums.phase.order);
    expect(enumsModule.STATUS_LABELS).toEqual(enums.checkStatus.labels);
    expect(enumsModule.CHECK_STATUS_VALUES).toEqual(enums.checkStatus.values);
    expect(enumsModule.HEALTH_LABELS).toEqual(enums.health.labels);
    expect(enumsModule.PRIORITY_ORDER).toEqual(enums.priority.order);
    expect(enumsModule.WORK_ITEM_TYPE_ORDER).toEqual(enums.workItemType.order);
    expect(enumsModule.WORK_ITEM_SOURCE_LABELS).toEqual(enums.workItemSource.labels);
    expect(enumsModule.ASSIGNEE_UNASSIGNED_VALUE).toBe(enums.assignee.unassignedValue);
  });

  test("ASSIGNEE_UNASSIGNED_VALUE union-safe sentinel matches .d.ts", () => {
    const match = /export const ASSIGNEE_UNASSIGNED_VALUE: "([^"]+)";/.exec(dtsText);
    expect(match?.[1]).toBe(enumsModule.ASSIGNEE_UNASSIGNED_VALUE);
  });
});
