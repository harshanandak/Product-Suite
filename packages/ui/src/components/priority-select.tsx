import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/select";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type Priority,
} from "#components/priority-badge";

/**
 * The exact options `PrioritySelect` renders, in severity order — the single
 * source of truth for the list. Exported so consumers (and tests) can assert
 * the rendered set without driving the Radix portal.
 */
export const PRIORITY_SELECT_OPTIONS: readonly {
  value: Priority;
  label: string;
}[] = PRIORITY_ORDER.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

export interface PrioritySelectProps {
  /** The currently selected priority. */
  value: Priority;
  /** Fired with the next priority when the user picks an option. */
  onValueChange: (priority: Priority) => void;
  /** id forwarded to the trigger (associates an external `<label>`). */
  id?: string;
  /** Accessible name when no visible label is wired up. */
  "aria-label"?: string;
  /** Disables the whole control. */
  disabled?: boolean;
  /** Trigger height, forwarded to `SelectTrigger`. */
  size?: "sm" | "default";
  /** Placeholder shown by `SelectValue` (rarely visible — `value` is required). */
  placeholder?: string;
  /** Extra classes merged onto the trigger. */
  className?: string;
}

/**
 * Token-styled, fully keyboard-accessible priority picker built on the shared
 * `Select` family (mirrors {@link PhaseSelect}). Renders the four canonical
 * priorities in severity order using `PRIORITY_LABELS`, so app code never
 * hand-rolls a `<select>` for priority (DESIGN §5).
 *
 * @example
 * ```tsx
 * <PrioritySelect value={priority} onValueChange={setPriority} aria-label="Priority" />
 * ```
 */
function PrioritySelect({
  value,
  onValueChange,
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "default",
  placeholder = "Select priority",
  className,
}: Readonly<PrioritySelectProps>) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as Priority)}
      disabled={disabled}
    >
      <SelectTrigger
        data-slot="priority-select-trigger"
        id={id}
        aria-label={ariaLabel}
        size={size}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent data-slot="priority-select-content">
        {PRIORITY_SELECT_OPTIONS.map(({ value: priority, label }) => (
          <SelectItem key={priority} value={priority}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { PrioritySelect };
