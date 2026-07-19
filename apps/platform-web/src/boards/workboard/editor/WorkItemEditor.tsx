import { useEffect, useId, useMemo, useState } from "react";

import {
  AssigneePicker,
  Button,
  HealthBadge,
  Input,
  Label,
  PhaseSelect,
  PrioritySelect,
  ProvenanceChip,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  StatusPill,
  TagInput,
  Textarea,
  WorkItemTypeSelect,
} from "@product-suite/ui";

import {
  deriveHealth,
  type Owner,
  type Phase,
  type Priority,
  type Check,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemType,
} from "@/data/work-items";

/**
 * Props for {@link WorkItemEditor}.
 *
 * The four-prop core (`item`, `open`, `onOpenChange`, `onSave`) is the contract
 * shared by EVERY surface that opens the editor — table row, future kanban card,
 * future graph node — so the editor stays view-agnostic.
 *
 * `checks` and `owners` are the two ADDITIVE, OPTIONAL extensions: the contract
 * intentionally passes `WorkItem` (which carries neither checks, owners, nor
 * stored health), yet the editor must show the item's checks, its DERIVED health
 * (§3 — health is computed on read, never stored), and resolve `assignee_id` to
 * a pickable owner. Rather than self-fetch (which would spin up a repository
 * disconnected from the opening surface's store), the caller supplies what it
 * already holds. A caller that passes exactly the four required props still
 * type-checks (`checks`/`owners` default to empty arrays — the owner picker then
 * offers only "Unassigned", which is correct for an empty roster).
 */
export interface WorkItemEditorProps {
  /** The item being edited; `null` closes the Sheet. */
  item: WorkItem | null;
  /** Controlled open state of the Sheet. */
  open: boolean;
  /** Sheet open/close (Esc, overlay click, Cancel, successful save). */
  onOpenChange: (open: boolean) => void;
  /**
   * Persist the edited patch. Wire to `hook.update(id, patch)`. MAY REJECT — on
   * rejection the editor keeps the Sheet open and surfaces the error (the hook
   * has already rolled back local state).
   */
  onSave: (id: string, patch: WorkItemPatch) => Promise<void>;
  /**
   * The item's checks (read-only) — feed derived health + the check list. The
   * caller passes the checks it already holds; defaults to none.
   */
  checks?: ReadonlyArray<Check>;
  /**
   * The pickable owners, used to resolve `assignee_id` → display in the owner
   * picker. The caller passes the roster it already holds; defaults to none
   * (the picker then offers only "Unassigned").
   */
  owners?: ReadonlyArray<Owner>;
}

/** The subset of {@link WorkItem} the editor edits, mirrored as local form state. */
interface EditorForm {
  title: string;
  description: string;
  type: WorkItemType;
  phase: Phase;
  priority: Priority;
  assignee_id: string | null;
  /** `YYYY-MM-DD` (the `<input type="date">` value), or `""` for no due date. */
  dueDate: string;
  department: string;
  tags: string[];
}

/**
 * Map a stored ISO-8601 timestamp to the `YYYY-MM-DD` an `<input type="date">`
 * expects, or `""` when there is no due date. Slicing the leading date portion
 * keeps the display stable regardless of the stored time-of-day.
 */
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * Inverse of {@link toDateInputValue}: turn the date-input value back into the
 * stored ISO-8601 form (midnight UTC, matching the seam's convention), or `null`
 * when the field is cleared.
 */
function fromDateInputValue(value: string): string | null {
  return value === "" ? null : `${value}T00:00:00.000Z`;
}

function toForm(item: WorkItem): EditorForm {
  return {
    title: item.title,
    description: item.description ?? "",
    type: item.type,
    phase: item.phase,
    priority: item.priority,
    assignee_id: item.assignee_id,
    dueDate: toDateInputValue(item.due_date),
    department: item.department,
    tags: [...item.tags],
  };
}

/** Order-insensitive set equality for the tag list. */
function sameTags(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((tag) => set.has(tag));
}

/**
 * Compute the minimal {@link WorkItemPatch} — only fields whose value changed —
 * so the save reflects the user's actual edits (and matches `WorkItemPatch`
 * partial semantics). `source` is never included: provenance is recorded once at
 * creation and is display-only (§11), so the editor renders it but never patches it.
 */
function diffPatch(item: WorkItem, form: EditorForm): WorkItemPatch {
  const patch: WorkItemPatch = {};

  const title = form.title.trim();
  if (title !== "" && title !== item.title) patch.title = title;

  // Description preserves whitespace/newlines; compare against the stored value
  // (absent ⇒ ""), so clearing a description patches it back to "".
  if (form.description !== (item.description ?? "")) {
    patch.description = form.description;
  }

  if (form.type !== item.type) patch.type = form.type;
  if (form.phase !== item.phase) patch.phase = form.phase;
  if (form.priority !== item.priority) patch.priority = form.priority;
  if (form.assignee_id !== item.assignee_id) patch.assignee_id = form.assignee_id;

  const dueDate = fromDateInputValue(form.dueDate);
  if (dueDate !== item.due_date) patch.due_date = dueDate;

  const department = form.department.trim();
  if (department !== item.department) patch.department = department;

  if (!sameTags(form.tags, item.tags)) patch.tags = form.tags;

  return patch;
}

/**
 * WorkItemEditor — the single, view-agnostic editor for a work item.
 *
 * Rendered as a controlled `@product-suite/ui` Sheet. Edits the full editable
 * {@link WorkItemPatch} surface — title, type, phase, priority, owner, due date,
 * department, tags — through shared `@product-suite/ui` primitives only (no bare
 * HTML form controls — §5). Shows the item's DERIVED health, its read-only
 * provenance ({@link ProvenanceChip}), and its checks with status. Accessibility
 * (focus trap, Esc-to-close, overlay dismiss) comes from the Sheet's controlled
 * `open`/`onOpenChange`; every field is explicitly labelled.
 */
export function WorkItemEditor({
  item,
  open,
  onOpenChange,
  onSave,
  checks = [],
  owners = [],
}: Readonly<WorkItemEditorProps>) {
  const titleId = useId();
  const descriptionId = useId();
  const typeId = useId();
  const phaseId = useId();
  const priorityId = useId();
  const ownerId = useId();
  const dueDateId = useId();
  const departmentId = useId();
  const tagsId = useId();

  const [form, setForm] = useState<EditorForm | null>(
    item ? toForm(item) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form + transient state whenever a different item is loaded (or the
  // Sheet reopens), so stale edits never leak across openings.
  const itemId = item?.id ?? null;
  useEffect(() => {
    setForm(item ? toForm(item) : null);
    setSaving(false);
    setError(null);
  }, [item, itemId, open]);

  // Checks belonging to this item (the caller may pass a superset).
  const itemChecks = useMemo(
    () => (item ? checks.filter((check) => check.work_item_id === item.id) : []),
    [item, checks],
  );

  const health = useMemo(
    () => (item ? deriveHealth(item, itemChecks) : null),
    [item, itemChecks],
  );

  const handleSave = async (): Promise<void> => {
    if (!item || !form) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(item.id, diffPatch(item, form));
      onOpenChange(false);
    } catch (cause) {
      // Keep the Sheet open and surface the failure (state already rolled back
      // upstream by the hook).
      setError(cause instanceof Error ? cause.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        aria-busy={saving}
      >
        <SheetHeader>
          <SheetTitle>{item ? "Edit work item" : "Work item"}</SheetTitle>
          <SheetDescription>
            Update the work item&apos;s details — type, phase, priority, owner,
            due date, team, and tags.
          </SheetDescription>
        </SheetHeader>

        {item && form ? (
          <form
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            {/* Title */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={titleId}>Title</Label>
              <Input
                id={titleId}
                value={form.title}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, title: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea
                id={descriptionId}
                value={form.description}
                disabled={saving}
                rows={4}
                placeholder="A short brief for this work item…"
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, description: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Type */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={typeId}>Type</Label>
              <WorkItemTypeSelect
                id={typeId}
                value={form.type}
                disabled={saving}
                onValueChange={(type) =>
                  setForm((prev) => (prev ? { ...prev, type } : prev))
                }
              />
            </div>

            {/* Phase */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={phaseId}>Phase</Label>
              <PhaseSelect
                id={phaseId}
                value={form.phase}
                disabled={saving}
                onValueChange={(phase) =>
                  setForm((prev) => (prev ? { ...prev, phase } : prev))
                }
              />
            </div>

            {/* Priority */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={priorityId}>Priority</Label>
              <PrioritySelect
                id={priorityId}
                value={form.priority}
                disabled={saving}
                onValueChange={(priority) =>
                  setForm((prev) => (prev ? { ...prev, priority } : prev))
                }
              />
            </div>

            {/* Owner */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={ownerId}>Owner</Label>
              <AssigneePicker
                id={ownerId}
                value={form.assignee_id}
                assignees={owners}
                disabled={saving}
                onValueChange={(assignee_id) =>
                  setForm((prev) => (prev ? { ...prev, assignee_id } : prev))
                }
              />
            </div>

            {/* Due date */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={dueDateId}>Due date</Label>
              <Input
                id={dueDateId}
                type="date"
                value={form.dueDate}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, dueDate: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Team */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={departmentId}>Team</Label>
              <Input
                id={departmentId}
                value={form.department}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, department: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={tagsId}>Tags</Label>
              <TagInput
                id={tagsId}
                value={form.tags}
                disabled={saving}
                onValueChange={(tags) =>
                  setForm((prev) => (prev ? { ...prev, tags } : prev))
                }
              />
            </div>

            {/* Source / provenance (read-only) */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none">Source</span>
              <div>
                <ProvenanceChip source={item.source} />
              </div>
              <p className="text-xs text-muted-foreground">
                Where this item came from — recorded once, not editable.
              </p>
            </div>

            {/* Derived health (read-only) */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none">
                Health
              </span>
              <div>
                {health ? (
                  <HealthBadge health={health} />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Derived from checks and dates — not editable.
              </p>
            </div>

            {/* Checks (read-only) */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none">
                Checks
                {itemChecks.length > 0 ? ` (${itemChecks.length})` : ""}
              </span>
              {itemChecks.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {itemChecks.map((check) => (
                    <li
                      key={check.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {check.title}
                      </span>
                      <StatusPill status={check.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No checks yet.</p>
              )}
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}

        <SheetFooter>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !item}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
