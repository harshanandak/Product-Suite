import * as React from "react";
import { XIcon } from "lucide-react";

import { Input } from "#components/input";
import { cn } from "#lib/cn";

const TAG_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground";

export interface TagListProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The tags to display, in order. */
  tags: ReadonlyArray<string>;
  /**
   * Show at most this many tags inline; the rest collapse into a `+N` chip.
   * `undefined` (default) shows all tags.
   */
  max?: number;
}

/**
 * Read-only tag display (DESIGN §5 board grammar — the "Tags" table column).
 * When `max` is set and exceeded, the overflow collapses into a `+N` chip whose
 * `title` lists the hidden tags. Token-pure; no editing affordances.
 *
 * @example
 * ```tsx
 * <TagList tags={["supplier", "q3", "urgent"]} max={2} />
 * ```
 */
export function TagList({
  tags,
  max,
  className,
  ...props
}: Readonly<TagListProps>) {
  const visible = max === undefined ? tags : tags.slice(0, max);
  const hidden = max === undefined ? [] : tags.slice(max);
  return (
    <span
      {...props}
      data-slot="tag-list"
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
    >
      {visible.map((tag) => (
        <span key={tag} data-slot="tag-chip" className={TAG_CHIP_CLASS}>
          {tag}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          data-slot="tag-overflow"
          className={TAG_CHIP_CLASS}
          title={hidden.join(", ")}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Pure tag-add reducer: trims, drops blanks and duplicates, appends otherwise.
 * Returns the SAME array reference when nothing changes so callers can skip a
 * needless `onValueChange`. Exported so the keyboard behaviour is unit-testable
 * without a DOM (this package's tests are SSR-only, matching house style).
 */
export function addTagValue(
  tags: ReadonlyArray<string>,
  raw: string,
): string[] {
  const tag = raw.trim();
  if (tag === "" || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

/** Pure tag-remove reducer: drops every occurrence of `tag`. */
export function removeTagValue(
  tags: ReadonlyArray<string>,
  tag: string,
): string[] {
  return tags.filter((t) => t !== tag);
}

export interface TagInputProps {
  /** Current tags (controlled). */
  value: ReadonlyArray<string>;
  /** Fired with the next tag array on add/remove. */
  onValueChange: (tags: string[]) => void;
  /** id forwarded to the text input (associates an external `<label>`). */
  id?: string;
  /** Accessible name for the text input when no visible label is wired up. */
  "aria-label"?: string;
  /** Placeholder for the text input. */
  placeholder?: string;
  /** Disables adding and removing. */
  disabled?: boolean;
  /** Extra classes merged onto the outer field. */
  className?: string;
}

/**
 * Editable tag field (DESIGN §5). Type a tag and press Enter (or comma) to add;
 * press Backspace on an empty input to remove the last tag; each tag has a real
 * `<button>` remove control (keyboard + screen-reader accessible, never a
 * clickable span). Duplicate and blank tags are ignored. Controlled — owns no
 * tag state, only the draft text.
 *
 * @example
 * ```tsx
 * <TagInput value={tags} onValueChange={setTags} aria-label="Tags" />
 * ```
 */
function TagInput({
  value,
  onValueChange,
  id,
  "aria-label": ariaLabel,
  placeholder = "Add a tag…",
  disabled,
  className,
}: Readonly<TagInputProps>) {
  const [draft, setDraft] = React.useState("");

  const addTag = (raw: string) => {
    const next = addTagValue(value, raw);
    if (next.length !== value.length) onValueChange(next);
    setDraft("");
  };

  const removeTag = (tag: string) => {
    onValueChange(removeTagValue(value, tag));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      const last = value.at(-1);
      if (last !== undefined) removeTag(last);
    }
  };

  return (
    <div
      data-slot="tag-input"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md border border-input bg-transparent p-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {value.map((tag) => (
        <span key={tag} data-slot="tag-chip" className={TAG_CHIP_CLASS}>
          {tag}
          <button
            type="button"
            data-slot="tag-remove"
            aria-label={`Remove ${tag}`}
            disabled={disabled}
            onClick={() => removeTag(tag)}
            className="inline-flex size-3.5 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <Input
        id={id}
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(draft)}
        className="h-6 flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}

export { TagInput };
