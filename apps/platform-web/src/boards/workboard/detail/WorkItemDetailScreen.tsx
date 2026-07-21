import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Link, useParams } from "@tanstack/react-router";

import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  HealthBadge,
  Input,
  PhasePill,
  PriorityBadge,
  ProvenanceChip,
  Separator,
  Skeleton,
  Spinner,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  WorkItemTypeBadge,
} from "@product-suite/ui";

import {
  childrenByParent,
  getDefaultRepository,
  taskProgress,
  useItemChecks,
  useRepositoryContext,
  useWorkItems,
  type ActivityEvent,
  type Owner,
  type Check,
  type WorkItemPatch,
  type WorkItemRepository,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkItemEditor } from "../editor/WorkItemEditor";

/**
 * Props for {@link WorkItemDetailScreen}. Like the other live screens it
 * self-provides its data; the optional `repository` SEAM lets tests drive it
 * against a controlled fixture store without touching the module singleton.
 */
export interface WorkItemDetailScreenProps {
  repository?: WorkItemRepository;
}

/** Short human date (`Oct 14`) from a stored ISO-8601 string, or `—`. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Two-char initials for an owner avatar, from stored initials or the name. */
function ownerInitials(owner: Owner): string {
  if (owner.initials && owner.initials.trim() !== "") return owner.initials;
  const parts = owner.name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

/** One label → value row in the right-rail Properties list. */
function PropertyRow({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** A tab with no rows yet — honest placeholder, not fake content. */
function EmptyTab({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <div className="py-10">
      <EmptyState title={title} description={description} />
    </div>
  );
}

/** Overview narrative block — the description brief and tags. */
function OverviewTab({ row }: Readonly<{ row: WorkItemRow }>) {
  const hasDescription = Boolean(row.description && row.description.trim() !== "");
  return (
    <section className="space-y-5">
      {hasDescription ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {row.description}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No description yet — use Edit to add a brief.
        </p>
      )}

      {row.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {row.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Order a copy of the checks with open ones first, completed last. */
function openFirst(checks: ReadonlyArray<Check>): Check[] {
  return [...checks].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "completed" ? 1 : -1,
  );
}

/**
 * Checks module — the item's real check records (open first), WRITABLE (move ②).
 * Promoted from a standalone tab onto the Overview (§C module order); it carries
 * its own "Checks" heading + progress bar so the section reads on its own. Each
 * row's checkbox advances the check one step around the status triad
 * (`onToggle` → repo `toggleStatus`); the header form adds a check (`onAdd` →
 * repo `createCheck`). Both surface a transient pending cue and never block the
 * module — a failure is reported by the parent via a toast.
 */
function ChecksModule({
  checks,
  completed,
  total,
  pct,
  onToggle,
  onAdd,
  pendingCheckIds,
}: Readonly<{
  checks: ReadonlyArray<Check>;
  completed: number;
  total: number;
  pct: number;
  onToggle: (id: string) => void;
  onAdd: (title: string) => Promise<void>;
  pendingCheckIds: ReadonlySet<string>;
}>) {
  const inputId = useId();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "" || adding) return;
    setAdding(true);
    try {
      await onAdd(trimmed);
      // Clear only on success; on failure the text is kept so the user can retry.
      setTitle("");
    } catch {
      // The parent surfaces the failure (toast); keep the field for a retry.
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Checks</h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {completed} of {total} · {pct}%
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Check progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <Input
          id={inputId}
          value={title}
          disabled={adding}
          placeholder="Add a check…"
          aria-label="New check title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={adding || title.trim() === ""}
          className="shrink-0"
        >
          {adding ? <Spinner className="size-4" /> : "Add"}
        </Button>
      </form>

      {checks.length === 0 ? (
        <EmptyTab
          title="No checks yet"
          description="Break this work item into checks to track progress."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {openFirst(checks).map((check) => {
            const pending = pendingCheckIds.has(check.id);
            const completed = check.status === "completed";
            return (
              <li
                key={check.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Checkbox
                    checked={completed}
                    disabled={pending}
                    aria-label={`Advance status of ${check.title}`}
                    onCheckedChange={() => onToggle(check.id)}
                  />
                  <span
                    className={`min-w-0 truncate text-sm${
                      completed
                        ? " text-muted-foreground line-through"
                        : ""
                    }`}
                  >
                    {check.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {pending ? (
                    <Spinner className="size-3.5 text-muted-foreground" />
                  ) : null}
                  {check.due_date ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(check.due_date)}
                    </span>
                  ) : null}
                  <StatusPill status={check.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A parent's `n/m` task rollup — a segmented bar (▰▰▱) plus the fraction. */
function TaskProgressMeter({
  completed,
  total,
}: Readonly<{ completed: number; total: number }>) {
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
      aria-label={`${completed} of ${total} tasks complete`}
    >
      <span aria-hidden className="flex gap-0.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`h-2 w-3 rounded-sm ${
              index < completed ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </span>
      <span className="tabular-nums">
        {completed}/{total}
      </span>
    </span>
  );
}

/**
 * Tasks module — the item's owned child tier (§11). Lists each child Task as a
 * link to its own detail page with a status pill, headed by an `n/m` rollup, and
 * offers an inline "+ Add task" that creates a child under this item. One level
 * deep: a Task never nests further here.
 */
function TasksModule({
  tasks,
  completed,
  total,
  workspace,
  onAddTask,
}: Readonly<{
  tasks: ReadonlyArray<WorkItemRow>;
  completed: number;
  total: number;
  workspace: string;
  onAddTask: (title: string) => Promise<void>;
}>) {
  const inputId = useId();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "" || adding) return;
    setAdding(true);
    try {
      await onAddTask(trimmed);
      setTitle("");
    } catch {
      // The parent surfaces the failure (toast); keep the field for a retry.
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Tasks</h2>
        {total > 0 ? (
          <TaskProgressMeter completed={completed} total={total} />
        ) : null}
      </div>

      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                to="/w/$workspace/workboard/item/$itemId"
                params={{ workspace, itemId: task.id }}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 truncate">{task.title}</span>
                <PhasePill phase={task.phase} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tasks yet — break this item down with “Add task”.
        </p>
      )}

      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <Input
          id={inputId}
          value={title}
          disabled={adding}
          placeholder="Add a task…"
          aria-label="New task title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={adding || title.trim() === ""}
          className="shrink-0"
        >
          {adding ? <Spinner className="size-4" /> : "Add task"}
        </Button>
      </form>
    </section>
  );
}

/** Activity tab — the item's append-only change log (newest first). */
function ActivityTab({
  activity,
}: Readonly<{ activity: ReadonlyArray<ActivityEvent> }>) {
  if (activity.length === 0) {
    return (
      <EmptyTab
        title="No activity yet"
        description="Changes to this item will appear here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {activity.map((event) => (
        <li key={event.id} className="flex items-start gap-3 text-sm">
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
          />
          <span className="min-w-0 flex-1">{event.summary}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDate(event.created_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Right rail — quiet, always-visible Properties + tags. */
function PropertiesRail({
  row,
  owner,
  projectName,
  linkedCount,
}: Readonly<{
  row: WorkItemRow;
  owner: Owner | undefined;
  projectName: string | undefined;
  linkedCount: number;
}>) {
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border p-5 lg:block">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Properties
      </h2>
      <div className="mt-2 divide-y divide-border">
        <PropertyRow label="Type">
          <WorkItemTypeBadge type={row.type} />
        </PropertyRow>
        <PropertyRow label="Status">
          <PhasePill phase={row.phase} />
        </PropertyRow>
        <PropertyRow label="Priority">
          <PriorityBadge priority={row.priority} />
        </PropertyRow>
        <PropertyRow label="Health">
          <HealthBadge health={row.health} />
        </PropertyRow>
        <PropertyRow label="Owner">
          {owner ? (
            <span className="inline-flex items-center gap-2">
              <Avatar className="size-5 text-[10px]">
                <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
              </Avatar>
              {owner.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </PropertyRow>
        <PropertyRow label="Due">
          <span className="tabular-nums">{formatDate(row.due_date)}</span>
        </PropertyRow>
        <PropertyRow label="Team">{row.department}</PropertyRow>
        <PropertyRow label="Project">{projectName ?? "—"}</PropertyRow>
        <PropertyRow label="Source">
          <ProvenanceChip source={row.source} />
        </PropertyRow>
        <PropertyRow label="Dependencies">
          <span className="tabular-nums">{linkedCount}</span>
        </PropertyRow>
      </div>

      {row.tags.length > 0 ? (
        <>
          <Separator className="my-4" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}

/**
 * WORK ITEM DETAIL SCREEN — the full-page view of one work item
 * (`/w/$workspace/workboard/item/$itemId`).
 *
 * A real route (not the right-side editor Sheet) so a work item gets a durable,
 * linkable home. It self-fetches through the same {@link useWorkItems} seam every
 * other surface uses, resolves the item by route param, and composes entirely
 * from `@product-suite/ui` primitives (§5 — tokens via semantic classes). Tabs
 * backed by real model data (Overview · Checks · Activity) render live; Edit opens
 * the shared {@link WorkItemEditor} Sheet and the Activity feed refreshes on save.
 */
export function WorkItemDetailScreen({
  repository,
}: Readonly<WorkItemDetailScreenProps> = {}) {
  const { workspace, itemId } = useParams({
    from: "/w/$workspace/workboard/item/$itemId",
  });

  const contextRepo = useRepositoryContext();
  const [repo] = useState<WorkItemRepository>(
    () => repository ?? contextRepo ?? getDefaultRepository(),
  );

  const {
    items,
    owners,
    projects,
    dependencies,
    loading,
    error,
    refetch,
    update,
    create,
  } = useWorkItems({ repository: repo });

  // Checks for this item's Checks tab + progress rollup (per-item fetch), now with
  // the two write gestures (check-off + add) wired through the repository.
  const {
    checks,
    createCheck,
    toggleStatus,
    pendingCheckIds,
  } = useItemChecks({ repository: repo, workItemId: itemId });

  // Activity log for the Activity tab (append-only; loaded per item).
  const [activity, setActivity] = useState<ReadonlyArray<ActivityEvent>>([]);
  useEffect(() => {
    let cancelled = false;
    repo
      .listActivity(itemId)
      .then((loaded) => {
        if (!cancelled) setActivity(loaded);
      })
      .catch(() => {
        // Supplementary; the Activity tab shows its empty state if this fails.
      });
    return () => {
      cancelled = true;
    };
  }, [repo, itemId]);

  // Every mutation (work-item edit, check add/toggle) appends an ActivityEvent —
  // re-read the feed so the change shows immediately. Non-fatal on failure.
  const refreshActivity = useCallback(async (): Promise<void> => {
    try {
      setActivity(await repo.listActivity(itemId));
    } catch {
      // The feed stays as-is until the next load.
    }
  }, [repo, itemId]);

  const [editing, setEditing] = useState(false);
  const handleSave = useCallback(
    async (id: string, patch: WorkItemPatch): Promise<void> => {
      await update(id, patch);
      // The header already reflects the edit via the hook; refresh the feed too.
      await refreshActivity();
    },
    [update, refreshActivity],
  );

  // Check-off gesture: advance a check one step around the status triad. Optimistic
  // in the hook; a failure rolls back there and is surfaced here as a toast.
  const handleToggleCheck = useCallback(
    (id: string): void => {
      toggleStatus(id)
        .then(refreshActivity)
        .catch(() => {
          toast.error("Couldn't update the check — please try again.");
        });
    },
    [toggleStatus, refreshActivity],
  );

  // Add gesture: create a check under this item. Re-throws on failure so the
  // Checks form keeps the typed title for a retry (it also gets the toast).
  const handleAddCheck = useCallback(
    async (title: string): Promise<void> => {
      try {
        await createCheck({ title });
        await refreshActivity();
      } catch (cause) {
        toast.error("Couldn't add the check — please try again.");
        throw cause;
      }
    },
    [createCheck, refreshActivity],
  );

  // Add gesture for the Tasks module: create a CHILD work item under this item
  // (a Task). The hook prepends it to `items`, so it shows in the Tasks module
  // immediately; re-throws on failure so the form keeps the typed title.
  const handleAddTask = useCallback(
    async (title: string): Promise<void> => {
      try {
        await create({ title, parent_id: itemId });
        await refreshActivity();
      } catch (cause) {
        toast.error("Couldn't add the task — please try again.");
        throw cause;
      }
    },
    [create, itemId, refreshActivity],
  );

  const row = useMemo<WorkItemRow | undefined>(
    () => items.find((candidate) => candidate.id === itemId),
    [items, itemId],
  );
  const owner = useMemo<Owner | undefined>(
    () => owners.find((candidate) => candidate.id === row?.assignee_id),
    [owners, row],
  );
  const projectName = useMemo(
    () => projects.find((candidate) => candidate.id === row?.project_id)?.name,
    [projects, row],
  );
  const linkedCount = useMemo(
    () =>
      dependencies.filter(
        (edge) =>
          edge.source_item_id === itemId || edge.target_item_id === itemId,
      ).length,
    [dependencies, itemId],
  );

  // Child Tasks under this item + their n/m rollup (Task 3.1 selectors).
  const childTasks = useMemo<WorkItemRow[]>(
    () => childrenByParent(items).get(itemId) ?? [],
    [items, itemId],
  );
  const taskRollup = useMemo(() => taskProgress(childTasks), [childTasks]);

  // The parent item when THIS item is itself a Task — drives the breadcrumb.
  const parentRow = useMemo<WorkItemRow | undefined>(
    () =>
      row?.parent_id != null
        ? items.find((candidate) => candidate.id === row.parent_id)
        : undefined,
    [items, row],
  );

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 gap-1.5">
      <Link to="/w/$workspace/workboard" params={{ workspace }}>
        <span aria-hidden>←</span> Workboard
      </Link>
    </Button>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <ErrorState
          title="Couldn’t load this work item"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={refetch}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <EmptyState
          title="Work item not found"
          description="It may have been deleted, or the link is out of date."
          action={backLink}
        />
      </div>
    );
  }

  // Derive progress from the LIVE per-item checks (not the hook's list-level
  // snapshot) so a check-off / add updates the header + progress bar instantly,
  // in lock-step with the Checks tab — one source of truth for this item.
  const total = checks.length;
  const completed = checks.filter((check) => check.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0">
      {/* Main column — document + tabs */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {backLink}

          {parentRow ? (
            <nav
              aria-label="Breadcrumb"
              className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <Link
                to="/w/$workspace/workboard/item/$itemId"
                params={{ workspace, itemId: parentRow.id }}
                className="min-w-0 truncate hover:text-foreground hover:underline"
              >
                {parentRow.title}
              </Link>
              <span aria-hidden>▸</span>
              <span className="min-w-0 truncate text-foreground">{row.title}</span>
            </nav>
          ) : null}

          <header className="mt-3">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-2xl font-semibold tracking-tight">
                {row.title}
              </h1>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <WorkItemTypeBadge type={row.type} />
              <PhasePill phase={row.phase} />
              <PriorityBadge priority={row.priority} />
              <HealthBadge health={row.health} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{owner ? owner.name : "Unassigned"}</span>
              <span>·</span>
              <span>Due {formatDate(row.due_date)}</span>
              <span>·</span>
              <span>
                {completed}/{total} checks
              </span>
              {projectName ? (
                <>
                  <span>·</span>
                  <span>{projectName}</span>
                </>
              ) : null}
            </div>
          </header>

          <Tabs defaultValue="overview" className="mt-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-8 pt-5">
              {/* §C module order: description → Checks → Tasks. */}
              <OverviewTab row={row} />
              <ChecksModule
                checks={checks}
                completed={completed}
                total={total}
                pct={pct}
                onToggle={handleToggleCheck}
                onAdd={handleAddCheck}
                pendingCheckIds={pendingCheckIds}
              />
              <TasksModule
                tasks={childTasks}
                completed={taskRollup.completed}
                total={taskRollup.total}
                workspace={workspace}
                onAddTask={handleAddTask}
              />
            </TabsContent>

            <TabsContent value="activity" className="pt-5">
              <ActivityTab activity={activity} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <PropertiesRail
        row={row}
        owner={owner}
        projectName={projectName}
        linkedCount={linkedCount}
      />

      {/* Full editor Sheet — the same view-agnostic editor every surface opens.
          Row-click brings you to this page; "Edit" opens the quick-edit Sheet. */}
      <WorkItemEditor
        item={editing ? row : null}
        open={editing}
        onOpenChange={setEditing}
        onSave={handleSave}
        checks={checks}
        owners={owners}
      />
    </div>
  );
}

export default WorkItemDetailScreen;
