import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createOwnerFixtures,
  createCheckFixtures,
  createWorkItemFixtures,
  type Owner,
  type Check,
  type WorkItem,
} from "@/data/work-items";

import { WorkItemEditor } from "./WorkItemEditor";

// Radix Dialog (which Sheet wraps) needs ResizeObserver; jsdom lacks it. Radix
// Select additionally relies on Pointer Capture + scrollIntoView, neither of
// which jsdom implements — stub them so the listbox can open under test.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {
      /* no-op: jsdom has no ResizeObserver */
    }
    unobserve(): void {
      /* no-op: jsdom has no ResizeObserver */
    }
    disconnect(): void {
      /* no-op: jsdom has no ResizeObserver */
    }
  };
  const proto = globalThis.Element.prototype as unknown as {
    hasPointerCapture?: () => boolean;
    setPointerCapture?: () => void;
    releasePointerCapture?: () => void;
    scrollIntoView?: () => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

/**
 * Open a Radix `Select` combobox by its accessible name and pick an option by
 * its visible label. Radix opens on a pointer-down/up sequence and portals its
 * options; this mirrors a real pointer interaction (verified to fire
 * `onValueChange` in jsdom).
 */
async function selectOption(comboName: string, optionLabel: string): Promise<void> {
  const trigger = screen.getByRole("combobox", { name: comboName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0 });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionLabel });
  fireEvent.click(option);
}

function getFixtureItem(id = "wi_auth"): WorkItem {
  const item = createWorkItemFixtures().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture work item not found: ${id}`);
  return item;
}

function getFixtureChecks(workItemId: string): Check[] {
  return createCheckFixtures().filter((check) => check.work_item_id === workItemId);
}

function getOwners(): Owner[] {
  return createOwnerFixtures();
}

describe("WorkItemEditor", () => {
  it("seeds every editable field from the item and shows read-only provenance + checks", () => {
    const item = getFixtureItem(); // feature / high / user_amara / 2026-07-10 / [security, backend] / manual
    const checks = getFixtureChecks(item.id);

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={() => {}}
        onSave={vi.fn().mockResolvedValue(undefined)}
        checks={checks}
        owners={getOwners()}
      />,
    );

    // Text fields seeded from the item.
    expect(screen.getByLabelText("Title")).toHaveValue(item.title);
    expect(screen.getByLabelText("Department")).toHaveValue(item.department);
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-07-10");

    // Enum / picker triggers display the seeded value.
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent(
      "Feature",
    );
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveTextContent(
      "High",
    );
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveTextContent(
      "Amara Okafor",
    );

    // Tags seeded as removable chips (each carries a real remove button).
    expect(
      screen.getByRole("button", { name: "Remove security" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove backend" }),
    ).toBeInTheDocument();

    // Provenance is read-only (source label announced, no source picker).
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /source/i }),
    ).not.toBeInTheDocument();

    // Checks render with their status pills.
    expect(screen.getByText("Token verifier interface")).toBeInTheDocument();
    expect(screen.getByText("Session bridge wiring")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("edits priority + adds a tag and calls onSave with the combined patch, then closes", async () => {
    const item = getFixtureItem(); // priority: "high", tags: [security, backend]
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
        checks={getFixtureChecks(item.id)}
        owners={getOwners()}
      />,
    );

    // Change priority high -> critical.
    await selectOption("Priority", "Critical");

    // Add a tag via Enter.
    const tagInput = screen.getByLabelText("Tags");
    fireEvent.change(tagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({
        priority: "critical",
        tags: ["security", "backend", "urgent"],
      }),
    );
    // Successful save closes the Sheet.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("edits the phase and calls onSave with the patch, then closes", async () => {
    const item = getFixtureItem(); // phase: "execute"
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
        checks={getFixtureChecks(item.id)}
        owners={getOwners()}
      />,
    );

    // Select the "Done" phase (different from the fixture's "execute").
    await selectOption("Phase", "Done");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({ phase: "done" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("clears the due date and patches it to null", async () => {
    const item = getFixtureItem(); // due_date: 2026-07-10T00:00:00.000Z
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        owners={getOwners()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({ due_date: null }),
    );
  });

  it("does not patch the title when the field is cleared to empty", async () => {
    const item = getFixtureItem(); // has a non-empty title
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        owners={getOwners()}
      />,
    );

    // Clear the title, then make an unrelated edit so a patch is produced.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Department"), {
      target: { value: "Platform" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][1];
    expect(patch).not.toHaveProperty("title");
    expect(patch).toMatchObject({ department: "Platform" });
  });

  it("closes via Cancel without saving", () => {
    const item = getFixtureItem();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the Sheet open and shows an error when onSave rejects", async () => {
    const item = getFixtureItem();
    const onSave = vi.fn().mockRejectedValue(new Error("write failed"));
    const onOpenChange = vi.fn();

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
        owners={getOwners()}
      />,
    );

    await selectOption("Phase", "Done");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Error surfaced; Sheet NOT asked to close.
    expect(await screen.findByRole("alert")).toHaveTextContent("write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
