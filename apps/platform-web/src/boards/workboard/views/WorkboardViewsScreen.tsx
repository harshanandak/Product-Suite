import { useCallback, useState } from "react";

import { useNavigate, useParams } from "@tanstack/react-router";

import { Button, EmptyState } from "@product-suite/ui";

import { DEFAULT_WORKSPACE } from "@/env";

import {
  FILTER_STORAGE_KEY,
  SAVED_VIEWS_KEY,
  defaultWorkboardFilterState,
  parseSavedViews,
  serializePersistedView,
  serializeSavedViews,
  type PersistedView,
  type SavedView,
  type WorkboardFilterState,
} from "../filter-state";

/**
 * Read + parse the saved-views list from localStorage. NEVER throws: SSR (no
 * `window`) and a privacy-mode `getItem` throw both yield `[]`, and a
 * malformed/absent payload is tolerated by {@link parseSavedViews}. Mirrors
 * WorkboardScreen's guarded read.
 */
function readSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

/**
 * Hydrate a full {@link WorkboardFilterState} from a saved {@link PersistedView}
 * config — each present field wins over a fresh {@link defaultWorkboardFilterState},
 * the `Set`s are CLONED so the stored config is never aliased, and `selection` is
 * forced empty. This is the same merge WorkboardScreen applies on mount, so
 * writing `serializePersistedView(hydrate(config))` to {@link FILTER_STORAGE_KEY}
 * makes the workboard restore EXACTLY this view when it next mounts.
 */
function hydrate(config: PersistedView): WorkboardFilterState {
  const base = defaultWorkboardFilterState();
  return {
    ...base,
    search: config.search ?? base.search,
    layout: config.layout ?? base.layout,
    groupBy: config.groupBy ?? base.groupBy,
    sortBy: config.sortBy ?? base.sortBy,
    tasks: config.tasks ?? base.tasks,
    filters: config.filters
      ? {
          type: new Set(config.filters.type),
          owner: new Set(config.filters.owner),
          team: new Set(config.filters.team),
          phase: new Set(config.filters.phase),
          priority: new Set(config.filters.priority),
        }
      : base.filters,
    visibleColumns: config.visibleColumns
      ? new Set(config.visibleColumns)
      : base.visibleColumns,
    selection: base.selection,
  };
}

/**
 * Persist the saved-views list back to localStorage after a delete. Guarded for
 * SSR + privacy-mode throws, like WorkboardScreen's persist effect.
 */
function writeSavedViews(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(views));
  } catch {
    /* ignore quota / privacy-mode throws — the list still lives in memory */
  }
}

/**
 * Saved Views SCREEN (`/w/$workspace/workboard/views`) — the Phase-2 home for the
 * user's named Layout×Group×Filter×Sort combos. Views are SAVED from the
 * workboard toolbar's "Save current view"; this surface lists them, applies one
 * (by writing its config to {@link FILTER_STORAGE_KEY} then navigating to the
 * workboard, which hydrates that config on mount), or deletes one.
 *
 * The list is the same localStorage-backed {@link SavedView} set the toolbar's
 * "Saved views" menu reads (SAVED_VIEWS_KEY), so a view saved on the workboard
 * appears here immediately on navigation.
 */
export function WorkboardViewsScreen() {
  const navigate = useNavigate();
  const { workspace } = useParams({ strict: false });
  const workspaceSlug = workspace ?? DEFAULT_WORKSPACE;

  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    readSavedViews(),
  );

  // Apply a saved view: write its hydrated config to the workboard's single
  // last-applied key, then navigate to the workboard — which reads that key in
  // its mount initializer and restores the view. Fire-and-forget navigation; the
  // trailing .catch keeps this void-returning handler from floating a promise.
  const applyView = useCallback(
    (view: SavedView): void => {
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            FILTER_STORAGE_KEY,
            serializePersistedView(hydrate(view.config)),
          );
        } catch {
          /* ignore quota / privacy-mode throws */
        }
      }
      navigate({
        to: "/w/$workspace/workboard",
        params: { workspace: workspaceSlug },
      }).catch(() => undefined);
    },
    [navigate, workspaceSlug],
  );

  const deleteView = useCallback((id: string): void => {
    setSavedViews((views) => {
      const next = views.filter((view) => view.id !== id);
      writeSavedViews(next);
      return next;
    });
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Saved views</h1>
        <p className="text-sm text-muted-foreground">
          Apply a saved combination of layout, grouping, filters, and sort — or
          save a new one from the workboard toolbar.
        </p>
      </header>

      {savedViews.length === 0 ? (
        <EmptyState
          title="No saved views yet"
          description="Open the workboard, set up a layout, grouping, filters, and sort you like, then use “Save current view” to keep it here."
          action={
            <Button
              size="sm"
              onClick={() =>
                navigate({
                  to: "/w/$workspace/workboard",
                  params: { workspace: workspaceSlug },
                }).catch(() => undefined)
              }
            >
              Go to workboard
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Saved views">
          {savedViews.map((view) => (
            <li
              key={view.id}
              className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Apply view ${view.name}`}
                onClick={() => {
                  applyView(view);
                }}
              >
                {view.name}
              </button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete view ${view.name}`}
                onClick={() => {
                  deleteView(view.id);
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
