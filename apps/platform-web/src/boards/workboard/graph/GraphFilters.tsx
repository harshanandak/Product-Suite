import { FilterIcon, XIcon } from "lucide-react";

import {
  Button,
  Input,
  type Phase,
  type Priority,
  type WorkItemType,
} from "@product-suite/ui";

import type { Owner } from "@/data/work-items";

import {
  buildFacetOptions,
  toggledSet,
  type WorkboardFilterState,
} from "../filter-state";
import { FacetFilterMenu } from "../toolbar/FacetFilterMenu";

/**
 * Floating FILTER cluster for the Graph view — search + the five facet menus
 * (Type / Owner / Department / Phase / Priority) + a clear action. It lives
 * INSIDE the canvas (a top-left React Flow Panel) and mutates the shared
 * {@link WorkboardFilterState}; the screen runs {@link applyWorkboardFilters}
 * over it so the graph renders only the matching work items.
 *
 * Controlled (holds no state): every toggle hands a NEW state object up via
 * `onChange`. Reuses the Table toolbar's {@link FacetFilterMenu} + the shared
 * {@link buildFacetOptions}, so the graph and the table filter identically.
 * Wrapped in a frosted (border-less) surface so it stays legible over the canvas
 * without adding a hard frame.
 */
export interface GraphFiltersProps {
  /** The shared filter state this cluster mutates. */
  value: WorkboardFilterState;
  /** Fired with a NEW state object on every change (controlled contract). */
  onChange: (next: WorkboardFilterState) => void;
  /** Pickable owners (feeds the Owner facet, plus "Unassigned"). */
  owners: ReadonlyArray<Owner>;
  /** Department names present in the data (feeds the Department facet). */
  departments: ReadonlyArray<string>;
}

export function GraphFilters({
  value,
  onChange,
  owners,
  departments,
}: Readonly<GraphFiltersProps>) {
  const { filters } = value;
  const options = buildFacetOptions(owners, departments);
  const activeFilterCount =
    filters.type.size +
    filters.owner.size +
    filters.department.size +
    filters.phase.size +
    filters.priority.size;

  const setSearch = (search: string): void => {
    onChange({ ...value, search });
  };
  const toggleType = (type: WorkItemType): void => {
    onChange({ ...value, filters: { ...filters, type: toggledSet(filters.type, type) } });
  };
  const toggleOwner = (ownerId: string): void => {
    onChange({ ...value, filters: { ...filters, owner: toggledSet(filters.owner, ownerId) } });
  };
  const toggleDepartment = (department: string): void => {
    onChange({
      ...value,
      filters: { ...filters, department: toggledSet(filters.department, department) },
    });
  };
  const togglePhase = (phase: Phase): void => {
    onChange({ ...value, filters: { ...filters, phase: toggledSet(filters.phase, phase) } });
  };
  const togglePriority = (priority: Priority): void => {
    onChange({
      ...value,
      filters: { ...filters, priority: toggledSet(filters.priority, priority) },
    });
  };

  /** Reset search AND the facets (so a search alone can't strand an empty graph). */
  const clearAll = (): void => {
    onChange({
      ...value,
      search: "",
      filters: {
        type: new Set(),
        owner: new Set(),
        department: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    });
  };

  const isActive = activeFilterCount > 0 || value.search.trim() !== "";

  return (
    <div
      role="toolbar"
      aria-label="Graph filters"
      aria-orientation="horizontal"
      className="flex flex-wrap items-center gap-2 rounded-lg bg-background/85 p-1.5 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/65"
    >
      <Input
        type="search"
        value={value.search}
        aria-label="Search work items"
        placeholder="Search"
        className="w-44 border-0 bg-muted/60 shadow-none"
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <span className="inline-flex items-center text-muted-foreground" aria-hidden="true">
        <FilterIcon className="size-4" />
      </span>
      <FacetFilterMenu
        label="Type"
        variant="ghost"
        options={options.type}
        selected={filters.type}
        onToggle={toggleType}
      />
      <FacetFilterMenu
        label="Owner"
        variant="ghost"
        options={options.owner}
        selected={filters.owner}
        onToggle={toggleOwner}
      />
      <FacetFilterMenu
        label="Department"
        variant="ghost"
        options={options.department}
        selected={filters.department}
        onToggle={toggleDepartment}
      />
      <FacetFilterMenu
        label="Phase"
        variant="ghost"
        options={options.phase}
        selected={filters.phase}
        onToggle={togglePhase}
      />
      <FacetFilterMenu
        label="Priority"
        variant="ghost"
        options={options.priority}
        selected={filters.priority}
        onToggle={togglePriority}
      />
      {isActive ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          aria-label={`Clear filters (${activeFilterCount} active)`}
        >
          <XIcon className="size-4" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
