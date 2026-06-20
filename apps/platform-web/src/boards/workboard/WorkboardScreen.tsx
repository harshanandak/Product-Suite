import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@product-suite/ui";

import {
  getDefaultRepository,
  useWorkItems,
  type Task,
  type WorkItemPatch,
  type WorkItemRepository,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkItemEditor } from "./editor/WorkItemEditor";
import { WorkboardTable } from "./table/WorkboardTable";

/**
 * Props for {@link WorkboardScreen}.
 *
 * The screen self-provides its data (it IS the live route), so the only prop is
 * the repository SEAM — optional, defaulting to the shared module singleton.
 * Injecting it lets tests drive the screen against a controlled fixture store
 * without touching that singleton.
 */
export interface WorkboardScreenProps {
  /** Repository to read/write through; defaults to the shared module singleton. */
  repository?: WorkItemRepository;
}

/**
 * Workboard SCREEN — the live composition of the Table + Editor over the data
 * seam (DESIGN §2 / §4).
 *
 * Owns the selected-item state: a table row activation opens the editor Sheet;
 * saves flow through the hook's optimistic `update` (which the table also uses
 * for inline/bulk phase edits, so both surfaces share one store and never
 * desync). The table renders its own skeleton/error states from the
 * `loading`/`error` props; the screen adds only the loaded-but-empty state.
 *
 * Tasks are read once from the repository (the hook surfaces only rows +
 * projects) and passed whole to the editor, which filters them per item — one
 * deterministic fetch, no per-selection race.
 */
export function WorkboardScreen({
  repository,
}: Readonly<WorkboardScreenProps> = {}) {
  // Stabilize the repository for the lifetime of the screen so the hook and our
  // own task read share ONE store (the hook captures its repo once, on mount —
  // a fresh instance per render would silently desync the two). With no injected
  // prop we route through the SAME module singleton the hook defaults to, so
  // optimistic edits persist across navigation instead of resetting per mount.
  const [repo] = useState<WorkItemRepository>(
    () => repository ?? getDefaultRepository(),
  );

  const { items, loading, error, update, refetch } = useWorkItems({
    repository: repo,
  });

  // Tasks for the editor (derived health + the read-only task list). Loaded once;
  // tasks do not change on a work-item save, so no refetch is wired.
  const [tasks, setTasks] = useState<ReadonlyArray<Task>>([]);
  useEffect(() => {
    let cancelled = false;
    repo
      .listTasks()
      .then((loaded) => {
        if (!cancelled) setTasks(loaded);
      })
      .catch(() => {
        // Tasks are supplementary to the editor; a failure simply yields an
        // editor with no task list / "on track" derived health. The table's
        // own error path covers the primary load.
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const [selected, setSelected] = useState<WorkItemRow | null>(null);

  const handleSelectItem = useCallback((row: WorkItemRow) => {
    setSelected(row);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelected(null);
  }, []);

  // Editor's onSave returns void; the hook's update returns the saved WorkItem.
  // Await + discard, and let rejections propagate so the editor keeps the Sheet
  // open and surfaces the error (the hook has already rolled back local state).
  const handleSave = useCallback(
    async (id: string, patch: WorkItemPatch): Promise<void> => {
      await update(id, patch);
    },
    [update],
  );

  // Keep the open Sheet's snapshot fresh after an inline/bulk edit reflows
  // `items`, so a re-opened/derived view never shows a stale row.
  const selectedId = selected?.id ?? null;
  const liveSelected = useMemo(
    () =>
      selectedId === null
        ? null
        : (items.find((row) => row.id === selectedId) ?? selected),
    [items, selectedId, selected],
  );

  const isEmpty = !loading && !error && items.length === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Workboard
        </p>
        <h1 className="text-xl font-semibold text-foreground">Work items</h1>
      </header>

      {isEmpty ? (
        <EmptyState
          title="No work items yet"
          description="Work items are the coalition hub — create one to plan, execute, and review work across departments."
        />
      ) : (
        <WorkboardTable
          items={items}
          loading={loading}
          error={error}
          onRetry={refetch}
          onSelectItem={handleSelectItem}
          onUpdateItem={update}
        />
      )}

      <WorkItemEditor
        item={liveSelected}
        open={liveSelected !== null}
        onOpenChange={handleOpenChange}
        onSave={handleSave}
        tasks={tasks}
      />
    </section>
  );
}
