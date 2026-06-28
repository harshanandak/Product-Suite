import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@product-suite/ui";

import type { FacetOption } from "../filter-state";

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
  variant = "outline",
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
  /** Trigger button style — `outline` (Table toolbar) or `ghost` (graph canvas). */
  variant?: "outline" | "ghost";
}>) {
  const count = selected.size;
  // Surface the active-selection count in the accessible name (it otherwise
  // shows only as a visual badge) — mirror the Clear-filters `(N)` pattern.
  const triggerLabel =
    count > 0
      ? `Filter by ${label.toLowerCase()} (${count})`
      : `Filter by ${label.toLowerCase()}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
        {options.map((option) => (
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
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
