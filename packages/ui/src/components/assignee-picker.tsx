import { UserIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "#components/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/select";
import { cn } from "#lib/cn";

/** A person who can own a work item. */
export interface Assignee {
  /** Stable id (internal id, never a provider id). */
  id: string;
  /** Display name shown in the trigger and the option list. */
  name: string;
  /** Optional 1–2 char initials; derived from `name` when omitted. */
  initials?: string;
  /** Optional avatar image URL. */
  avatarUrl?: string;
}

/**
 * Radix `Select` forbids empty-string item values, so the "Unassigned" option
 * carries this sentinel and is mapped to/from `null` at the component boundary.
 * Exported so tests can assert the mapping without driving the portal.
 *
 * This value is reserved: no real {@link Assignee.id} may equal it (it would
 * round-trip to `null` and become impossible to select). The component rejects
 * any colliding `assignees` entry up front — see {@link AssigneePicker}.
 */
export const ASSIGNEE_UNASSIGNED_VALUE = "__unassigned__";

/** Derive up-to-2-char initials from a display name. */
function initialsFor(assignee: Assignee): string {
  if (assignee.initials) return assignee.initials;
  return assignee.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function AssigneeAvatar({
  assignee,
}: Readonly<{ assignee: Assignee }>) {
  return (
    <Avatar size="sm" data-slot="assignee-avatar">
      {assignee.avatarUrl ? (
        <AvatarImage src={assignee.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback>{initialsFor(assignee)}</AvatarFallback>
    </Avatar>
  );
}

export interface AssigneePickerProps {
  /** The currently selected owner id, or `null` for unassigned. */
  value: string | null;
  /** Fired with the next owner id (`null` when "Unassigned" is chosen). */
  onValueChange: (assigneeId: string | null) => void;
  /** The pickable people. */
  assignees: ReadonlyArray<Assignee>;
  /** id forwarded to the trigger (associates an external `<label>`). */
  id?: string;
  /** Accessible name when no visible label is wired up. */
  "aria-label"?: string;
  /** Disables the whole control. */
  disabled?: boolean;
  /** Trigger height, forwarded to `SelectTrigger`. */
  size?: "sm" | "default";
  /**
   * Trigger chrome, forwarded to `SelectTrigger`. `ghost` is flat/borderless for
   * Notion-style inline table cells (the avatar+name display is unchanged);
   * `default` keeps the bordered control.
   */
  variant?: "default" | "ghost";
  /** Label for the unassigned option / placeholder. */
  unassignedLabel?: string;
  /** Extra classes merged onto the trigger. */
  className?: string;
}

/**
 * Token-styled, keyboard-accessible owner picker (DESIGN §5) built on the
 * shared `Select` and `Avatar` families. Renders an avatar/initials display per
 * person and always offers an "Unassigned" option (a work item may be routed to
 * a department queue with no owner — §1/§11). App code never hand-rolls an
 * owner `<select>`.
 *
 * `null` ⇄ {@link ASSIGNEE_UNASSIGNED_VALUE} is handled internally so callers
 * work purely in terms of `assignee_id: string | null`.
 *
 * @example
 * ```tsx
 * <AssigneePicker
 *   value={item.assignee_id}
 *   onValueChange={setAssignee}
 *   assignees={people}
 *   aria-label="Owner"
 * />
 * ```
 */
function AssigneePicker({
  value,
  onValueChange,
  assignees,
  id,
  "aria-label": ariaLabel,
  disabled,
  size = "default",
  variant = "default",
  unassignedLabel = "Unassigned",
  className,
}: Readonly<AssigneePickerProps>) {
  if (assignees.some((a) => a.id === ASSIGNEE_UNASSIGNED_VALUE)) {
    throw new Error(
      `AssigneePicker: "${ASSIGNEE_UNASSIGNED_VALUE}" is reserved for the ` +
        "unassigned option and cannot be used as an assignee id.",
    );
  }

  const selected = value === null
    ? null
    : (assignees.find((a) => a.id === value) ?? null);

  return (
    <Select
      value={value ?? ASSIGNEE_UNASSIGNED_VALUE}
      onValueChange={(next) =>
        onValueChange(next === ASSIGNEE_UNASSIGNED_VALUE ? null : next)
      }
      disabled={disabled}
    >
      <SelectTrigger
        data-slot="assignee-picker-trigger"
        id={id}
        aria-label={ariaLabel}
        size={size}
        variant={variant}
        className={cn("min-w-40", className)}
      >
        <SelectValue placeholder={unassignedLabel}>
          {selected ? (
            <span className="flex items-center gap-2">
              <AssigneeAvatar assignee={selected} />
              {selected.name}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <UserIcon aria-hidden="true" className="size-4" />
              {unassignedLabel}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent data-slot="assignee-picker-content">
        <SelectItem value={ASSIGNEE_UNASSIGNED_VALUE}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <UserIcon aria-hidden="true" className="size-4" />
            {unassignedLabel}
          </span>
        </SelectItem>
        {assignees.map((assignee) => (
          <SelectItem key={assignee.id} value={assignee.id}>
            <span className="flex items-center gap-2">
              <AssigneeAvatar assignee={assignee} />
              {assignee.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { AssigneePicker };
