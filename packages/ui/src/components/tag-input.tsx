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

/**
 * Pure blur predicate: did focus leave the whole field? `false` when focus moved
 * to a control *inside* `root` (e.g. a tag's remove button) so the draft is not
 * committed as a stray tag mid-click. Exported for DOM-free unit testing,
 * matching this package's SSR-only test style.
 */
export function blurLeavesField(
  root: HTMLElement | null,
  relatedTarget: Node | null,
): boolean {
  return root === null || !root.contains(relatedTarget);
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
  /**
   * Field chrome. `default` is the bordered field. `ghost` is flat/borderless
   * for Notion-style inline table cells: no border/background at rest, a subtle
   * hover surface, and each tag's ✕ remove control revealed on hover/focus.
   */
  variant?: "default" | "ghost";
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
  variant = "default",
  className,
}: Readonly<TagInputProps>) {
  const [draft, setDraft] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);

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

  // Commit the draft only when focus leaves the whole field — not when it moves
  // to an internal control (e.g. a remove button), which would add a stray tag.
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!blurLeavesField(rootRef.current, event.relatedTarget)) return;
    addTag(draft);
  };

  return (
    <div
      ref={rootRef}
      data-slot="tag-input"
      data-variant={variant}
      onBlur={handleBlur}
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md p-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        variant === "default" && "border border-input bg-transparent",
        variant === "ghost" &&
          "border border-transparent bg-transparent hover:bg-accent/50",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          data-slot="tag-chip"
          className={cn(TAG_CHIP_CLASS, variant === "ghost" && "group/tag")}
        >
          {tag}
          <button
            type="button"
            data-slot="tag-remove"
            aria-label={`Remove ${tag}`}
            disabled={disabled}
            onClick={() => removeTag(tag)}
            className={cn(
              "inline-flex size-3.5 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none",
              // Ghost cells keep chips quiet: the ✕ stays hidden until the chip
              // is hovered or the button itself is keyboard-focused.
              variant === "ghost" &&
                "opacity-0 transition-opacity group-hover/tag:opacity-100 focus-visible:opacity-100",
            )}
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
        className="h-6 flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}

export { TagInput };
