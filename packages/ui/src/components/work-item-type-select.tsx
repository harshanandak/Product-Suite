import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/select";
import {
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
  WorkItemTypeBadge,
  type WorkItemType,
} from "#components/work-item-type-badge";

/**
 * The exact options `WorkItemTypeSelect` renders, in display order — the single
 * source of truth for the list. Exported so consumers (and tests) can assert
 * the rendered set without driving the Radix portal.
 */
export const WORK_ITEM_TYPE_SELECT_OPTIONS: readonly {
  value: WorkItemType;
  label: string;
}[] = WORK_ITEM_TYPE_ORDER.map((value) => ({
  value,
  label: WORK_ITEM_TYPE_LABELS[value],
}));

export interface WorkItemTypeSelectProps {
  /** The currently selected work-item type. */
  value: WorkItemType;
  /** Fired with the next type when the user picks an option. */
  onValueChange: (type: WorkItemType) => void;
  /** id forwarded to the trigger (associates an external `<label>`). */
  id?: string;
  /** Accessible name when no visible label is wired up. */
  "aria-label"?: string;
  /** Disables the whole control. */
  disabled?: boolean;
  /** Trigger height, forwarded to `SelectTrigger`. */
  size?: "sm" | "default";
  /**
   * Trigger chrome, forwarded to `SelectTrigger`. `ghost` renders the value as a
   * borderless {@link WorkItemTypeBadge} (Notion-style inline table cell);
   * `default` keeps the bordered control.
   */
  variant?: "default" | "ghost";
  /** Placeholder shown by `SelectValue` (rarely visible — `value` is required). */
  placeholder?: string;
  /** Extra classes merged onto the trigger. */
  className?: string;
}

/**
 * Token-styled, fully keyboard-accessible work-item-type picker built on the
 * shared `Select` family (mirrors {@link PhaseSelect}). Renders the four
 * canonical types using `WORK_ITEM_TYPE_LABELS`, so app code never hand-rolls a
 * `<select>` for type (DESIGN §5).
 *
 * @example
 * ```tsx
 * <WorkItemTypeSelect value={type} onValueChange={setType} aria-label="Type" />
 * ```
 */
function WorkItemTypeSelect({
  value,
  onValueChange,
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "default",
  variant = "default",
  placeholder = "Select type",
  className,
}: Readonly<WorkItemTypeSelectProps>) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as WorkItemType)}
      disabled={disabled}
    >
      <SelectTrigger
        data-slot="work-item-type-select-trigger"
        id={id}
        aria-label={ariaLabel}
        size={size}
        variant={variant}
        className={className}
      >
        {variant === "ghost" ? (
          <SelectValue placeholder={placeholder}>
            <WorkItemTypeBadge type={value} />
          </SelectValue>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent data-slot="work-item-type-select-content">
        {WORK_ITEM_TYPE_SELECT_OPTIONS.map(({ value: type, label }) => (
          <SelectItem key={type} value={type}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { WorkItemTypeSelect };
