import { type FormEvent, useState } from "react";

import {
  Button,
  Input,
  Label,
  TagInput,
  Textarea,
  cn,
} from "@product-suite/ui";

import type {
  CreateMemoryInput,
  MemoryKind,
  MemoryRow,
  ScopeType,
} from "@/data/memories";

/** Props for {@link LogDecisionForm}. */
export interface LogDecisionFormProps {
  /** Create mutation from `useMemories` (returns the newly-active memory). */
  create: (input: CreateMemoryInput) => Promise<MemoryRow>;
  /** Called with the created memory after a successful submit. */
  onCreated?: (memory: MemoryRow) => void;
  /** Optional dismiss affordance (renders a Cancel button when provided). */
  onCancel?: () => void;
}

/** The two human-creatable kinds in P1 (`rule` is P2). */
const KINDS: { value: MemoryKind; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "fact", label: "Fact" },
];

/** Scope choices; `org` needs no id, the narrower scopes take an optional id. */
const SCOPES: { value: ScopeType; label: string }[] = [
  { value: "org", label: "Org" },
  { value: "project", label: "Project" },
  { value: "work_item_type", label: "Type" },
  { value: "work_item", label: "Item" },
];

/**
 * The capture-friction keystone (Memory Brain P1): log a decision or fact in ONE
 * step. `title` is the only required field; on submit it POSTs to
 * `/api/memories` and the memory is ACTIVE immediately (no review). Mirrors the
 * inbox's sub-form grammar (bordered `bg-card` panel, `@product-suite/ui`
 * primitives, toggle-chip Buttons for kind/scope like the reject reason chips).
 */
export function LogDecisionForm({
  create,
  onCreated,
  onCancel,
}: Readonly<LogDecisionFormProps>) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<MemoryKind>("decision");
  const [topics, setTopics] = useState<string[]>([]);
  const [scopeType, setScopeType] = useState<ScopeType>("org");
  const [scopeId, setScopeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !submitting;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    // Guard the empty-title case even if the button is somehow enabled (Enter
    // key, assistive tech) — the backend requires a title and so do we.
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const trimmedScopeId = scopeId.trim();
    const input: CreateMemoryInput = {
      kind,
      title: trimmedTitle,
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(topics.length > 0 ? { topics } : {}),
      scopeType,
      ...(scopeType !== "org" && trimmedScopeId
        ? { scopeId: trimmedScopeId }
        : {}),
    };
    void create(input)
      .then((memory) => {
        // Reset to a clean slate so the form is immediately reusable.
        setTitle("");
        setBody("");
        setKind("decision");
        setTopics([]);
        setScopeType("org");
        setScopeId("");
        onCreated?.(memory);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't log this. Please try again.",
        );
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Log a decision"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="memory-title">Title</Label>
        <Input
          id="memory-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What was decided?"
          autoFocus
          required
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Kind</legend>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={kind === option.value ? "default" : "outline"}
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="memory-body">Details</Label>
        <Textarea
          id="memory-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Context, rationale, links (optional)"
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="memory-topics">Topics</Label>
        <TagInput
          id="memory-topics"
          value={topics}
          onValueChange={setTopics}
          aria-label="Topics"
          placeholder="Add a topic…"
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Scope</legend>
        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={scopeType === option.value ? "default" : "outline"}
              aria-pressed={scopeType === option.value}
              onClick={() => setScopeType(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {scopeType !== "org" ? (
          <Input
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            placeholder={`${scopeType} id (optional)`}
            aria-label="Scope id"
            className="mt-1.5"
          />
        ) : null}
      </fieldset>

      {error ? (
        <output className="block rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </output>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          className={cn(
            "bg-success text-success-foreground hover:bg-success/90",
            "focus-visible:ring-success/40",
          )}
        >
          {submitting ? "Logging…" : "Log it"}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
