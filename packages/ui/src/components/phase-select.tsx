import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/select"
import { PHASE_LABELS, type Phase } from "#components/phase-pill"

/** Phases in canonical loop order: plan → execute → review → done. */
const PHASE_ORDER: readonly Phase[] = ["plan", "execute", "review", "done"]

/**
 * The exact options `PhaseSelect` renders, in loop order — the single source of
 * truth for the list. Exported so consumers (and tests) can assert the rendered
 * set without driving the Radix portal.
 */
export const PHASE_SELECT_OPTIONS: readonly { value: Phase; label: string }[] =
  PHASE_ORDER.map((value) => ({ value, label: PHASE_LABELS[value] }))

export interface PhaseSelectProps {
  /** The currently selected phase. */
  value: Phase
  /** Fired with the next phase when the user picks an option. */
  onValueChange: (phase: Phase) => void
  /** id forwarded to the trigger (associates an external `<label>`). */
  id?: string
  /** Accessible name when no visible label is wired up. */
  "aria-label"?: string
  /** Disables the whole control. */
  disabled?: boolean
  /** Trigger height, forwarded to `SelectTrigger`. */
  size?: "sm" | "default"
  /** Placeholder shown by `SelectValue` (rarely visible — `value` is required). */
  placeholder?: string
  /** Extra classes merged onto the trigger. */
  className?: string
}

/**
 * Token-styled, fully keyboard-accessible phase picker built on the shared
 * `Select` family. Renders the four canonical phases (plan → execute → review →
 * done) using `PHASE_LABELS`, so app code never hand-rolls a `<select>` or a
 * radiogroup for phase selection (DESIGN §5).
 *
 * @example
 * ```tsx
 * <PhaseSelect value={phase} onValueChange={setPhase} aria-label="Phase" />
 * ```
 */
function PhaseSelect({
  value,
  onValueChange,
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "default",
  placeholder = "Select phase",
  className,
}: Readonly<PhaseSelectProps>) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as Phase)}
      disabled={disabled}
    >
      <SelectTrigger
        data-slot="phase-select-trigger"
        id={id}
        aria-label={ariaLabel}
        size={size}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent data-slot="phase-select-content">
        {PHASE_SELECT_OPTIONS.map(({ value: phase, label }) => (
          <SelectItem key={phase} value={phase}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { PhaseSelect }
