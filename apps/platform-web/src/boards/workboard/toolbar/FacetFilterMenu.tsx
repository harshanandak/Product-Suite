import { CheckIcon, FilterIcon } from "lucide-react";

import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@product-suite/ui";

import type { FacetOption } from "../filter-state";

/**
 * Above this many options a facet flagged `searchable` swaps its scroll-only
 * checkbox list for a cmdk type-to-filter list (#8). Short facets (Type, Phase,
 * Priority — and small Owner/Department sets) stay the plain checkbox menu.
 */
const SEARCHABLE_THRESHOLD = 8;

/**
 * A single multi-select facet filter rendered as a checkbox dropdown. Generic
 * over the facet's value type so Type/Owner/Department/Phase/Priority all share
 * one keyboard-accessible, token-styled menu. Each toggle hands a brand-new value
 * up via `onToggle`; the parent splices it into a fresh state object (controlled).
 *
 * Shared by the Workboard toolbar (Table view) and the graph's floating filter
 * cluster so both surfaces filter identically.
 */
export function FacetFilterMenu<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onSetSelected,
  searchable = false,
  variant = "outline",
  compact = false,
}: Readonly<{
  label: string;
  options: ReadonlyArray<FacetOption<T>>;
  selected: ReadonlySet<T>;
  onToggle: (value: T) => void;
  /**
   * Replace the WHOLE facet selection in one shot — backs the "Select all /
   * Clear" header row. Supplied as a single set (not N `onToggle`s) because the
   * parent's `onChange` is a plain setter over a stale `value`, so looping
   * `onToggle` would be last-write-wins; one full set lands atomically. The
   * header row renders only when this is wired.
   */
  onSetSelected?: (next: Set<T>) => void;
  /**
   * Opt the facet into type-to-filter (#8). Only takes effect once the option
   * count clears {@link SEARCHABLE_THRESHOLD} — short lists stay scroll-free
   * checkbox menus. Wired on the long, data-driven Owner/Department facets.
   */
  searchable?: boolean;
  /** Trigger button style — `outline` (Table toolbar) or `ghost` (graph canvas). */
  variant?: "outline" | "ghost";
  /**
   * Render a COMPACT, icon-only trigger (a funnel) for the table COLUMN HEADER
   * use — accent + the selected count when active, a neutral muted funnel at
   * rest — instead of the labelled toolbar button. The portalled menu (options,
   * Select all / Clear header, searchable list) is identical either way; only the
   * trigger differs, so the existing toolbar/graph usage is untouched.
   */
  compact?: boolean;
}>) {
  const count = selected.size;
  // Type-to-filter only when the facet asked for it AND the list is long enough
  // to warrant a search box; otherwise keep the plain checkbox menu (#8).
  const enableSearch = searchable && options.length > SEARCHABLE_THRESHOLD;
  // Surface the active-selection count in the accessible name (it otherwise
  // shows only as a visual badge) — mirror the Clear-filters `(N)` pattern.
  const triggerLabel =
    count > 0
      ? `Filter by ${label.toLowerCase()} (${count})`
      : `Filter by ${label.toLowerCase()}`;
  // Compact (column-header) trigger keeps the facet's OWN name — "Filter Type" /
  // "Filter Type (1)" — distinct from the toolbar's "Filter by type".
  const compactLabel = count > 0 ? `Filter ${label} (${count})` : `Filter ${label}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="xs"
            aria-label={compactLabel}
            // Active = accent funnel + the selected count; neutral muted funnel at
            // rest. `shrink-0` so it sits beside the (truncating) column label
            // without being squeezed.
            className={cn(
              "shrink-0",
              count > 0 ? "text-primary" : "text-muted-foreground",
            )}
          >
            <FilterIcon aria-hidden="true" />
            {count > 0 ? (
              <span data-slot="facet-count" className="text-xs tabular-nums">
                {count}
              </span>
            ) : null}
          </Button>
        ) : (
          <Button variant={variant} size="sm" aria-label={triggerLabel}>
            {label}
            {count > 0 ? (
              <span
                data-slot="facet-count"
                className="ml-1 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground"
              >
                {count}
              </span>
            ) : null}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onSetSelected ? (
          <>
            <div className="flex items-center gap-1 px-1 pb-1">
              <DropdownMenuItem
                className="flex-1 justify-center text-xs"
                // Keep the menu open so the user can verify the bulk change.
                onSelect={(event) => {
                  event.preventDefault();
                  onSetSelected(new Set(options.map((option) => option.value)));
                }}
              >
                Select all
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex-1 justify-center text-xs"
                onSelect={(event) => {
                  event.preventDefault();
                  onSetSelected(new Set());
                }}
              >
                Clear
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {enableSearch ? (
          <Command className="bg-transparent">
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}`}
              // Keep printable keys IN the field: Radix's menu typeahead would
              // otherwise swallow them to move roving focus. Arrow/Enter/Escape
              // still bubble, so cmdk navigation and menu-dismiss keep working.
              onKeyDown={(event) => {
                if (event.key.length === 1) {
                  event.stopPropagation();
                }
              }}
            />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // Filter by the visible label, not the opaque value.
                  value={option.label}
                  onSelect={() => {
                    onToggle(option.value);
                  }}
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4",
                      selected.has(option.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                  {/* cmdk items are role="option" with no checkbox semantics, so
                      voice the toggle state the (aria-hidden) check shows. cmdk
                      filters on the explicit `value`, not this text, so the cue
                      never pollutes search. */}
                  <span className="sr-only">
                    {selected.has(option.value) ? "selected" : "not selected"}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.has(option.value)}
              // Keep the menu open across multiple toggles.
              onSelect={(event) => {
                event.preventDefault();
              }}
              onCheckedChange={() => {
                onToggle(option.value);
              }}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
