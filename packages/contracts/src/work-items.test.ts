import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import * as workItemsModule from "./work-items.js";
import { deriveHealth, workItemsCore } from "./work-items.js";
import { enums } from "./enums.js";

/**
 * Drift guard for the framework-neutral work-item core vocabulary (move ②),
 * extending the tri-directional idea from `enums.test.ts`. The model's
 * enumerable / machine-readable content exists in THREE independent artifacts
 * that must never disagree:
 *   1. the JS runtime  (`work-items.js`)                — what code executes,
 *   2. the JSON mirror (`../contracts/work-items-core.json`) — the language-neutral source,
 *   3. the TS interfaces/unions (`index.d.ts`)          — what TypeScript consumers see.
 *
 * Each artifact is derived independently (the JSON is parsed from disk; the
 * union members + interface fields are extracted from the raw `.d.ts` TEXT, not
 * from a TS type — so they can actually disagree) and asserted equal. Nothing is
 * derived from another at test time, so these are not tautologies: add a field to
 * the interface but forget the JSON (or an enum member to the JS but not the
 * union) and this fails.
 */

const coreJson = JSON.parse(
  readFileSync(new URL("../contracts/work-items-core.json", import.meta.url), "utf8"),
) as typeof workItemsCore;

const dtsText = readFileSync(new URL("./index.d.ts", import.meta.url), "utf8");

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

/** Extract the string-literal members of `export type <Name> = "a" | "b";`. */
function unionMembers(typeName: string): string[] {
  const match = new RegExp(`export type ${typeName} =([^;]+);`).exec(dtsText);
  if (!match) {
    throw new Error(`Union type '${typeName}' not found in index.d.ts`);
  }
  const members = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`Union type '${typeName}' has no string-literal members`);
  }
  return members;
}

/** Extract the field identifiers declared in `export interface <Name> { ... }`. */
function interfaceFields(name: string): string[] {
  // The core interfaces contain no nested object braces, so the first line that
  // is just `}` closes the body.
  const match = new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(
    dtsText,
  );
  if (!match) {
    throw new Error(`Interface '${name}' not found in index.d.ts`);
  }
  const fields: string[] = [];
  for (const line of match[1].split("\n")) {
    const field = /^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??:/.exec(line);
    if (field) fields.push(field[1]);
  }
  if (fields.length === 0) {
    throw new Error(`Interface '${name}' has no fields`);
  }
  return fields;
}

/** Extract the picked keys of `export type WorkItemPatch = Partial<Pick<WorkItem, ...>>`. */
function workItemPatchKeys(): string[] {
  const match = /export type WorkItemPatch = Partial<\s*Pick<\s*WorkItem,([\s\S]*?)>\s*>;/.exec(
    dtsText,
  );
  if (!match) {
    throw new Error("WorkItemPatch Pick<> not found in index.d.ts");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("@product-suite/contracts work-items core — drift guard", () => {
  test("the JS `workItemsCore` object deep-equals contracts/work-items-core.json", () => {
    expect(workItemsCore).toEqual(coreJson);
  });

  test("named exports match the canonical `workItemsCore` object", () => {
    expect(workItemsModule.DEPENDENCY_RELATIONSHIP_VALUES).toEqual(
      workItemsCore.dependencyRelationship.values,
    );
    expect(workItemsModule.DEPENDENCY_RELATIONSHIP_DEFAULT).toBe(
      workItemsCore.dependencyRelationship.default,
    );
    expect(workItemsModule.ACTIVITY_EVENT_KIND_VALUES).toEqual(
      workItemsCore.activityEventKind.values,
    );
    expect(workItemsModule.STATUS_CATEGORY_VALUES).toEqual(
      workItemsCore.statusCategory.values,
    );
    expect(workItemsModule.WORK_ITEM_PATCH_FIELDS).toEqual(
      workItemsCore.workItemPatchFields,
    );
    expect(workItemsModule.TASK_PATCH_FIELDS).toEqual(workItemsCore.taskPatchFields);
  });

  test("DependencyRelationship: JS values, JSON, and the .d.ts union agree", () => {
    const jsValues = workItemsCore.dependencyRelationship.values;
    const jsonValues = coreJson.dependencyRelationship.values;
    const tsMembers = unionMembers("DependencyRelationship");
    expect(sorted(jsValues)).toEqual(sorted(jsonValues));
    expect(sorted(tsMembers)).toEqual(sorted(jsValues));
    // The declared default must be one of the members.
    expect(jsValues).toContain(workItemsCore.dependencyRelationship.default);
  });

  test("ActivityEventKind: JS values, JSON, and the .d.ts union agree", () => {
    const jsValues = workItemsCore.activityEventKind.values;
    const jsonValues = coreJson.activityEventKind.values;
    const tsMembers = unionMembers("ActivityEventKind");
    expect(sorted(jsValues)).toEqual(sorted(jsonValues));
    expect(sorted(tsMembers)).toEqual(sorted(jsValues));
  });

  test("StatusCategory: JS values, JSON, and the .d.ts union agree", () => {
    const jsValues = workItemsCore.statusCategory.values;
    const jsonValues = coreJson.statusCategory.values;
    const tsMembers = unionMembers("StatusCategory");
    expect(sorted(jsValues)).toEqual(sorted(jsonValues));
    expect(sorted(tsMembers)).toEqual(sorted(jsValues));
  });

  test("WorkItemPatch keys: JS/JSON list matches the .d.ts Pick<> and all are WorkItem fields", () => {
    const tsKeys = workItemPatchKeys();
    expect(sorted(workItemsCore.workItemPatchFields as string[])).toEqual(sorted(tsKeys));
    // Every editable key is a real WorkItem field (never a phantom).
    const workItemFields = new Set(interfaceFields("WorkItem"));
    for (const key of workItemsCore.workItemPatchFields as string[]) {
      expect(workItemFields.has(key)).toBe(true);
    }
    // `source` (provenance) is deliberately NOT editable.
    expect(workItemsCore.workItemPatchFields as string[]).not.toContain("source");
  });

  test.each(
    Object.keys(workItemsCore.objects) as Array<keyof typeof workItemsCore.objects>,
  )("%s: JSON field set equals the .d.ts interface field set", (name) => {
    const jsonFields = Object.keys(workItemsCore.objects[name].fields);
    const tsFields = interfaceFields(name);
    expect(sorted(jsonFields)).toEqual(sorted(tsFields));
  });

  test("every enum-typed field references an enum that actually exists", () => {
    const knownEnums = new Set<string>([
      ...Object.keys(enums),
      "dependencyRelationship",
      "activityEventKind",
      "statusCategory",
    ]);
    for (const object of Object.values(workItemsCore.objects)) {
      for (const field of Object.values(object.fields)) {
        if (typeof field.type === "object" && field.type.kind === "enum") {
          expect(knownEnums.has(field.type.enum)).toBe(true);
        }
      }
    }
  });

  test("deriveHealth applies the documented priority rules", () => {
    const NOW = Date.parse("2026-06-20T00:00:00.000Z");
    const PAST = "2026-06-10T00:00:00.000Z";
    const FUTURE = "2026-07-10T00:00:00.000Z";
    // Overdue item + open task → blocked (beats at_risk).
    expect(
      deriveHealth({ phase: "execute", due_date: PAST }, [
        { status: "todo", due_date: PAST },
      ], NOW),
    ).toBe("blocked");
    // Future item, one overdue open task → at_risk.
    expect(
      deriveHealth({ phase: "execute", due_date: FUTURE }, [
        { status: "in_progress", due_date: PAST },
      ], NOW),
    ).toBe("at_risk");
    // Done item, nothing open → on_track.
    expect(
      deriveHealth({ phase: "done", due_date: PAST }, [
        { status: "completed", due_date: null },
      ], NOW),
    ).toBe("on_track");
  });
});
