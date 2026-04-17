"use client";

import * as React from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CalendarDaysIcon, Clock3Icon, GripVerticalIcon, MoveVerticalIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function getValidDateValue(meeting) {
  const parsed = new Date(meeting.updated_at || meeting.created_at || 0);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0m";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatTimestamp(value) {
  const parsed = new Date(value || 0);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusVariant(status) {
  if (status === "completed") {
    return "secondary";
  }
  return "outline";
}

function normalizeMeeting(meeting) {
  const title = meeting.title || "Untitled meeting";
  const status = meeting.status || "created";
  const updatedValue = getValidDateValue(meeting);

  return {
    id: meeting.id,
    href: `/meetings/${meeting.id}`,
    title,
    status,
    duration: formatDuration(meeting.duration_seconds || 0),
    durationValue: Number(meeting.duration_seconds || 0),
    updatedValue,
    updatedLabel: formatTimestamp(meeting.updated_at || meeting.created_at),
    summary: `${status} \u00b7 ${meeting.duration_seconds || 0}s captured`,
  };
}

const SORT_COLUMN_BY_KEY = {
  title: "title",
  duration: "durationValue",
  updated: "updatedValue",
};

const SORT_KEY_BY_COLUMN = {
  title: "title",
  durationValue: "duration",
  updatedValue: "updated",
};

function isManualSortValue(value) {
  return value === "manual" || String(value || "").startsWith("manual:");
}

function reorderRows(current, sourceId, targetId, placement = "before") {
  const sourceIndex = current.findIndex((item) => item.id === sourceId);
  if (sourceIndex < 0) {
    return current;
  }

  const next = [...current];
  const [moved] = next.splice(sourceIndex, 1);
  const targetIndex = targetId == null || targetId === "end" ? next.length : next.findIndex((item) => item.id === targetId);
  const insertionIndex = targetIndex < 0 || targetIndex >= next.length ? next.length : placement === "after" ? targetIndex + 1 : targetIndex;
  next.splice(Math.max(0, Math.min(next.length, insertionIndex)), 0, moved);
  return next;
}

function MeetingRowDrawer({ row }) {
  const isMobile = useIsMobile();

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          Details
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{row.title}</DrawerTitle>
          <DrawerDescription>Reopen the meeting, review status, and continue the workspace thread.</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4 px-4 pb-2 text-sm">
          <div className="grid gap-3 rounded-3xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={getStatusVariant(row.status)} className="rounded-full capitalize">
                {row.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-medium tabular-nums">{row.duration}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Last update</span>
              <span className="text-right font-medium">{row.updatedLabel}</span>
            </div>
          </div>
          <div className="rounded-3xl border border-border bg-background p-4">
            <p className="font-medium">Workspace summary</p>
            <p className="mt-2 text-muted-foreground">{row.summary}</p>
          </div>
        </div>
        <DrawerFooter>
          <Link to={row.href} className={buttonVariants({})}>
            Open workspace
          </Link>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function DataTable({ meetings = [] }) {
  const [activeTab, setActiveTab] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [sortValue, setSortValue] = React.useState("manual");
  const [sorting, setSorting] = React.useState([]);
  const [rows, setRows] = React.useState(() => meetings.map(normalizeMeeting));
  const [draggedId, setDraggedId] = React.useState(null);

  React.useEffect(() => {
    const normalizedMeetings = meetings.map(normalizeMeeting);
    setRows((currentRows) => {
      if (currentRows.length === 0) {
        return normalizedMeetings;
      }

      const currentOrder = new Map(currentRows.map((row, index) => [row.id, index]));
      const incomingOrder = new Map(normalizedMeetings.map((row, index) => [row.id, index]));

      return [...normalizedMeetings].sort((left, right) => {
        const leftCurrentIndex = currentOrder.get(left.id);
        const rightCurrentIndex = currentOrder.get(right.id);

        if (leftCurrentIndex != null && rightCurrentIndex != null) {
          return leftCurrentIndex - rightCurrentIndex;
        }

        if (leftCurrentIndex != null) {
          return -1;
        }

        if (rightCurrentIndex != null) {
          return 1;
        }

        return (incomingOrder.get(left.id) ?? 0) - (incomingOrder.get(right.id) ?? 0);
      });
    });
  }, [meetings]);

  function applySortValue(nextValue) {
    setSortValue(nextValue);
    if (isManualSortValue(nextValue)) {
      setSorting([]);
      return;
    }

    const [nextKey, nextDirection] = nextValue.split(":");
    const columnId = SORT_COLUMN_BY_KEY[nextKey];
    if (!columnId) {
      setSorting([]);
      return;
    }

    setSorting([{ id: columnId, desc: nextDirection !== "asc" }]);
  }

  function handleSortChange(nextKey) {
    const columnId = SORT_COLUMN_BY_KEY[nextKey];
    if (!columnId) {
      return;
    }

    const activeSort = sorting[0];
    const nextDesc = activeSort?.id === columnId ? !activeSort.desc : nextKey !== "title";
    const nextValue = `${nextKey}:${nextDesc ? "desc" : "asc"}`;
    applySortValue(nextValue);
  }

  function handleDrop(event, targetId) {
    if (!draggedId || draggedId === targetId || !isManualSortValue(sortValue)) {
      setDraggedId(null);
      return;
    }

    const { top, height } = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY > top + height / 2 ? "after" : "before";
    setRows((current) => reorderRows(current, draggedId, targetId, placement));
    setDraggedId(null);
  }

  const handleReorderAction = React.useCallback(
    (sourceId, targetId, placement = "before") => {
      if (!targetId || !isManualSortValue(sortValue)) {
        return;
      }

      setRows((current) => reorderRows(current, sourceId, targetId, placement));
    },
    [sortValue],
  );

  const filteredRows = React.useMemo(
    () =>
      rows.filter((row) => {
        if (activeTab === "all") {
          return true;
        }

        return activeTab === "active" ? row.status !== "completed" : row.status === "completed";
      }),
    [activeTab, rows],
  );

  const columns = React.useMemo(
    () => [
      {
        id: "drag",
        enableSorting: false,
        header: () => (
          <>
            <span className="sr-only">Drag</span>
            <MoveVerticalIcon className="size-4 text-muted-foreground" />
          </>
        ),
        cell: ({ row, table }) => {
          const manualMode = isManualSortValue(sortValue);
          const rowModel = table.getRowModel().rows;
          const previousRowId = rowModel[row.index - 1]?.original.id;
          const nextRowId = rowModel[row.index + 1]?.original.id;

          return (
            <div className="flex items-center justify-center gap-1 text-muted-foreground">
              <GripVerticalIcon className="size-4" />
              {manualMode ? (
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Move ${row.original.title} up`}
                    disabled={!previousRowId}
                    onClick={() => handleReorderAction(row.original.id, previousRowId, "before")}
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Move ${row.original.title} down`}
                    disabled={!nextRowId}
                    onClick={() => handleReorderAction(row.original.id, nextRowId, "after")}
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "title",
        header: () => (
          <button type="button" className="inline-flex items-center gap-2" onClick={() => handleSortChange("title")}>
            Meeting
            <ArrowUpDownIcon className="size-4 text-muted-foreground" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link to={row.original.href} className="font-medium text-foreground hover:text-primary">
              {row.original.title}
            </Link>
            <div className="text-xs text-muted-foreground">{row.original.summary}</div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: () => "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)} className="rounded-full capitalize">
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "durationValue",
        header: () => (
          <button type="button" className="inline-flex items-center gap-2" onClick={() => handleSortChange("duration")}>
            Duration
            <ArrowUpDownIcon className="size-4 text-muted-foreground" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="inline-flex items-center gap-2">
            <Clock3Icon className="size-4 text-muted-foreground" />
            {row.original.duration}
          </div>
        ),
      },
      {
        accessorKey: "updatedValue",
        header: () => (
          <button type="button" className="inline-flex items-center gap-2" onClick={() => handleSortChange("updated")}>
            Last update
            <ArrowUpDownIcon className="size-4 text-muted-foreground" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="inline-flex items-center gap-2 text-muted-foreground">
            <CalendarDaysIcon className="size-4" />
            <span className="text-foreground">{row.original.updatedLabel}</span>
          </div>
        ),
      },
      {
        id: "details",
        header: () => <div className="text-right">Details</div>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-right">
            <MeetingRowDrawer row={row.original} />
          </div>
        ),
      },
    ],
    [handleReorderAction, sortValue, sorting],
  );

  const table = useReactTable({
    columns,
    data: filteredRows,
    state: {
      globalFilter: query,
      sorting,
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      const normalizedFilter = String(filterValue || "").trim().toLowerCase();
      if (!normalizedFilter) {
        return true;
      }

      const values = [row.original.title, row.original.status, row.original.summary, row.original.updatedLabel];
      return values.some((value) => String(value || "").toLowerCase().includes(normalizedFilter));
    },
    onGlobalFilterChange: setQuery,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const activeSort = sorting[0];
  const currentSortKey = isManualSortValue(sortValue) ? "manual" : sortValue.split(":")[0];
  const currentSortLabel = currentSortKey === "manual" ? "Drag rows to reorder." : `Sorted by ${currentSortKey}.`;

  function getHeaderAriaSort(headerId) {
    if (!["title", "durationValue", "updatedValue"].includes(headerId)) {
      return undefined;
    }

    if (activeSort?.id !== headerId) {
      return "none";
    }

    return activeSort.desc ? "descending" : "ascending";
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <section className="overflow-hidden rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-5 py-6">
        <div className="gap-4 md:flex md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Recent meetings</h2>
            <p className="text-sm leading-7 text-muted-foreground">Sortable workspace history with detail drawers and manual row ordering.</p>
          </div>
          <div className="mt-4 md:mt-0">
            <Badge variant="outline" className="rounded-full border-white/10 bg-transparent text-foreground/80">
              {visibleRows.length} shown
            </Badge>
          </div>
        </div>
        <div className="mt-6 space-y-4 border-y border-white/8 py-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <TabsList className="w-full justify-start xl:w-auto">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Open</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative min-w-[220px]">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search meetings" />
              </div>
              <Select value={sortValue} onValueChange={applySortValue}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue placeholder="Manual order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual order</SelectItem>
                  <SelectItem value="updated:desc">Latest update</SelectItem>
                  <SelectItem value="updated:asc">Oldest update</SelectItem>
                  <SelectItem value="duration:desc">Longest duration</SelectItem>
                  <SelectItem value="title:asc">Title A-Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-hidden border border-white/8 bg-black/10">
            <Table>
              <TableHeader className="bg-white/5">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        aria-sort={getHeaderAriaSort(header.id)}
                        className={
                          header.id === "drag"
                            ? "w-12"
                            : header.id === "status" || header.id === "durationValue" || header.id === "updatedValue" || header.id === "details"
                              ? "whitespace-nowrap"
                              : undefined
                        }
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {visibleRows.length ? (
                  visibleRows.map((row) => (
                    <TableRow
                      key={row.original.id}
                      draggable={isManualSortValue(sortValue)}
                      onDragStart={() => setDraggedId(row.original.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, row.original.id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={
                            cell.column.id === "title"
                              ? "min-w-[260px]"
                              : cell.column.id === "durationValue"
                                ? "tabular-nums whitespace-nowrap"
                                : cell.column.id === "status" || cell.column.id === "updatedValue" || cell.column.id === "details"
                                  ? "whitespace-nowrap"
                                  : undefined
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No meetings match the current filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="flex justify-between border-b border-white/8 py-4 text-sm text-muted-foreground">
          <span>{currentSortLabel}</span>
          <span>{activeTab === "all" ? "All statuses" : activeTab === "active" ? "Open meetings only" : "Completed meetings only"}</span>
        </div>
      </section>
    </Tabs>
  );
}
