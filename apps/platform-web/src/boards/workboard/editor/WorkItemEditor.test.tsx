import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createTaskFixtures,
  createWorkItemFixtures,
  type Task,
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
 * Open the PhaseSelect combobox and pick a phase by its visible label. Radix
 * Select opens on a pointer-down/up sequence and portals its options; this
 * mirrors a real pointer interaction (verified to fire `onValueChange` in jsdom).
 */
async function selectPhase(label: string): Promise<void> {
  const trigger = screen.getByRole("combobox", { name: "Phase" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0 });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: label });
  fireEvent.click(option);
}

function getFixtureItem(id = "wi_auth"): WorkItem {
  const item = createWorkItemFixtures().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture work item not found: ${id}`);
  return item;
}

function getFixtureTasks(workItemId: string): Task[] {
  return createTaskFixtures().filter((task) => task.work_item_id === workItemId);
}

describe("WorkItemEditor", () => {
  it("opens with the fixture item and shows its tasks with status", () => {
    const item = getFixtureItem();
    const tasks = getFixtureTasks(item.id);

    render(
      <WorkItemEditor
        item={item}
        open
        onOpenChange={() => {}}
        onSave={vi.fn().mockResolvedValue(undefined)}
        tasks={tasks}
      />,
    );

    // Title field is seeded from the item.
    expect(screen.getByLabelText("Title")).toHaveValue(item.title);
    // Tasks render with their status pills.
    expect(screen.getByText("Token verifier interface")).toBeInTheDocument();
    expect(screen.getByText("Session bridge wiring")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
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
        tasks={getFixtureTasks(item.id)}
      />,
    );

    // Select the "Done" phase (different from the fixture's "execute").
    await selectPhase("Done");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({ phase: "done" }),
    );
    // Successful save closes the Sheet.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
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
      />,
    );

    await selectPhase("Done");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Error surfaced; Sheet NOT asked to close.
    expect(await screen.findByRole("alert")).toHaveTextContent("write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
