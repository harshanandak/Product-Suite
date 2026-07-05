import { useCallback, useEffect, useMemo, useState } from "react";

import { Link, useParams } from "@tanstack/react-router";

import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  HealthBadge,
  PhasePill,
  PriorityBadge,
  ProvenanceChip,
  Separator,
  Skeleton,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WorkItemTypeBadge,
} from "@product-suite/ui";

import {
  getDefaultRepository,
  useWorkItems,
  type ActivityEvent,
  type Owner,
  type Task,
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

/** Overview tab — progress bar, the description brief, and tags. */
function OverviewTab({
  row,
  completed,
  total,
  pct,
}: Readonly<{
  row: WorkItemRow;
  completed: number;
  total: number;
  pct: number;
}>) {
  const hasDescription = Boolean(row.description && row.description.trim() !== "");
  return (
    <section className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground tabular-nums">
            {completed} of {total} tasks · {pct}%
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
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

/** Order a copy of the tasks with open ones first, completed last. */
function openFirst(tasks: ReadonlyArray<Task>): Task[] {
  return [...tasks].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "completed" ? 1 : -1,
  );
}

/** Tasks tab — the item's real task records (open first). */
function TasksTab({ tasks }: Readonly<{ tasks: ReadonlyArray<Task> }>) {
  if (tasks.length === 0) {
    return (
      <EmptyTab
        title="No tasks yet"
        description="Break this work item into tasks to track progress."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {openFirst(tasks).map((task) => (
        <li
          key={task.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
        >
          <span className="min-w-0 truncate text-sm">{task.title}</span>
          <div className="flex shrink-0 items-center gap-3">
            {task.due_date ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDate(task.due_date)}
              </span>
            ) : null}
            <StatusPill status={task.status} />
          </div>
        </li>
      ))}
    </ul>
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
        <PropertyRow label="Phase">
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
        <PropertyRow label="Department">{row.department}</PropertyRow>
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
 * backed by real model data (Overview · Tasks · Activity) render live; Edit opens
 * the shared {@link WorkItemEditor} Sheet and the Activity feed refreshes on save.
 */
export function WorkItemDetailScreen({
  repository,
}: Readonly<WorkItemDetailScreenProps> = {}) {
  const { workspace, itemId } = useParams({
    from: "/w/$workspace/workboard/item/$itemId",
  });

  const [repo] = useState<WorkItemRepository>(
    () => repository ?? getDefaultRepository(),
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
  } = useWorkItems({ repository: repo });

  // Tasks for this item's Tasks tab + progress rollup (per-item fetch).
  const [tasks, setTasks] = useState<ReadonlyArray<Task>>([]);
  useEffect(() => {
    let cancelled = false;
    repo
      .getTasks(itemId)
      .then((loaded) => {
        if (!cancelled) setTasks(loaded);
      })
      .catch(() => {
        // Supplementary to the row rollup; the screen's error path covers load.
      });
    return () => {
      cancelled = true;
    };
  }, [repo, itemId]);

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

  const [editing, setEditing] = useState(false);
  const handleSave = useCallback(
    async (id: string, patch: WorkItemPatch): Promise<void> => {
      await update(id, patch);
      // The mutation appended an ActivityEvent — refresh the feed so the edit
      // shows immediately (the header already reflects it via the hook).
      try {
        setActivity(await repo.listActivity(itemId));
      } catch {
        // Non-fatal — the feed stays as-is until the next load.
      }
    },
    [update, repo, itemId],
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

  const completed = row.completedTaskCount;
  const total = row.taskCount;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0">
      {/* Main column — document + tabs */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {backLink}

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
                {completed}/{total} tasks
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
              <TabsTrigger value="tasks">
                Tasks{total > 0 ? ` · ${total}` : ""}
              </TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-5">
              <OverviewTab
                row={row}
                completed={completed}
                total={total}
                pct={pct}
              />
            </TabsContent>

            <TabsContent value="tasks" className="pt-5">
              <TasksTab tasks={tasks} />
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
        tasks={tasks}
        owners={owners}
      />
    </div>
  );
}

export default WorkItemDetailScreen;
