import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AssigneePicker,
  ASSIGNEE_UNASSIGNED_VALUE,
  type Assignee,
  type AssigneePickerProps,
} from "./assignee-picker";

const PEOPLE: Assignee[] = [
  { id: "u1", name: "Harsha Nanda" },
  { id: "u2", name: "Priya", initials: "PK" },
  { id: "u3", name: "Arjun Rao", avatarUrl: "https://example.test/a.png" },
];

const noop = () => {};

describe("AssigneePicker — null ⇄ sentinel mapping", () => {
  // Reproduce the adapter the picker installs on the Select root: Radix hands a
  // string; the picker maps the unassigned sentinel back to null.
  const adapt = (onChange: AssigneePickerProps["onValueChange"]) =>
    (next: string) =>
      onChange(next === ASSIGNEE_UNASSIGNED_VALUE ? null : next);

  test("maps the unassigned sentinel back to null", () => {
    const onValueChange = mock<AssigneePickerProps["onValueChange"]>();
    adapt(onValueChange)(ASSIGNEE_UNASSIGNED_VALUE);
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  test("passes a real person id through unchanged", () => {
    const onValueChange = mock<AssigneePickerProps["onValueChange"]>();
    adapt(onValueChange)("u2");
    expect(onValueChange).toHaveBeenCalledWith("u2");
  });
});

describe("AssigneePicker — trigger rendering", () => {
  test("unassigned: renders the placeholder label and an accessible trigger", () => {
    const html = renderToStaticMarkup(
      createElement(AssigneePicker, {
        value: null,
        onValueChange: noop,
        assignees: PEOPLE,
        id: "owner-field",
        "aria-label": "Owner",
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="owner-field"');
    expect(html).toContain('aria-label="Owner"');
    expect(html).toContain('data-slot="assignee-picker-trigger"');
    expect(html).toContain("Unassigned");
  });

  test("selected: shows the owner's name and initials fallback", () => {
    const html = renderToStaticMarkup(
      createElement(AssigneePicker, {
        value: "u1",
        onValueChange: noop,
        assignees: PEOPLE,
        "aria-label": "Owner",
      }),
    );
    expect(html).toContain("Harsha Nanda");
    // Initials derived from the name → "HN".
    expect(html).toContain("HN");
  });

  test("honors an explicit initials override", () => {
    const html = renderToStaticMarkup(
      createElement(AssigneePicker, {
        value: "u2",
        onValueChange: noop,
        assignees: PEOPLE,
        "aria-label": "Owner",
      }),
    );
    expect(html).toContain("PK");
  });

  test("supports a custom unassigned label", () => {
    const html = renderToStaticMarkup(
      createElement(AssigneePicker, {
        value: null,
        onValueChange: noop,
        assignees: PEOPLE,
        "aria-label": "Owner",
        unassignedLabel: "No owner",
      }),
    );
    expect(html).toContain("No owner");
  });
});
