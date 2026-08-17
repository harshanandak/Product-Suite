---
name: ui-tokens
description: >
  Build or change Product-Suite UI so it lands on every surface it touches: the semantic
  tokens in packages/ui/src/styles/tokens.css (never a raw hex, never custom CSS where a
  token exists), the RIGHT ui-* package (ui, ui-chat, ui-canvas, ui-meeting, ui-planning,
  ui-charting), the consuming app under apps/, and dark mode. Enforces plain-English labels
  — a label that reads like an identifier (snake_case, "work item", "cycle") is a bug — and
  mockup fidelity: when a mockup exists, port its markup verbatim and bind data to it rather
  than reinventing from a feature list. Use for any visual or component work: "add a
  component", "style this page", "match the mockup", "the dark mode looks wrong", "what
  colour should this be", "these labels read like code", "build the board/canvas/chat UI",
  "add a variant", "check contrast", or when a diff touches tokens.css, a ui-* package, or a
  page under apps/*-web. NOT for the wire contract or data fetching (packages/contracts +
  packages/sdk), NOT for database schema work (db-migrate), and NOT for choosing what to
  build — this covers how it looks and where the change has to land.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

# ui-tokens

## Where a UI change has to land

A UI change is not done in one file. Walk this and say which rows apply:

| Surface | What |
|---|---|
| **Tokens** | `packages/ui/src/styles/tokens.css` — semantic tokens (oklch). New colour ⇒ new *semantic* token, not a hex in a component. |
| **Package** | The right `ui-*` package. Generic primitive ⇒ `ui`. Surface-specific ⇒ `ui-chat` / `ui-canvas` / `ui-meeting` / `ui-planning` / `ui-charting`. Putting a chat-only component in `ui` couples surfaces that are supposed to be separable. |
| **App** | The consuming app under `apps/` actually renders it. A component nobody mounted is not shipped. |
| **Dark mode** | Both themes, every time. Tokens make this free — hardcoded colours make it a bug you find later. |
| **Reverse states** | Empty, loading, error, and the inverse action (archive ⇒ unarchive). |

## Tokens, not custom CSS

Read `packages/ui/src/styles/tokens.css` before you pick a colour. If the thing you need
has a token, use it. If it does not, add a **semantic** one (`--color-surface-raised`, not
`--color-gray-150`) and say why in the PR.

A raw hex in a component is a review finding. So is a one-off `style={{ }}` that
duplicates a token.

## Labels are plain English

This is a never-compromise item, not a preference.

- `owner_user_id` is a column. **"Owner"** is a label.
- Never **"work item"** — the product word is **item**.
- Never **"cycle"** — it is not the user's vocabulary at all.
- Never **"nested"** — items are **connected**.
- *capture*, *injection*, *proposal*, *holdout* are internal engineering words. Fine in
  code, wrong in the UI.

When you rename something, grep for the old label across `apps/` and every `ui-*` package.
A stale label after a rename is one of the standards this project is judged on.

## When there is a mockup

Port the markup **verbatim** and bind data to it. Do not re-derive the design from a
bullet list of features — that reliably produces something that looks nothing like the
mockup and costs a full rebuild.

If you are fanning work out across several files, give each agent a ported exemplar to
match, and validate centrally rather than letting each one open a browser.

## Verifying

Targeted check for the package you touched:

```bash
bun run --cwd packages/ui test          # or ui-chat / ui-canvas / ui-meeting / ui-planning / ui-charting
bun run verify:platform-web             # lint + typecheck + test for the app
```

Anything user-visible gets **one integrated pass in the running app** — screenshot it in
both themes. A green unit test is not evidence that a page looks right.

## Standards this is measured against

- Board interactions feel instant.
- No lying spinners — a spinner means work is actually happening.
- Optimistic updates always reconcile.
- No stale labels after a rename.
- Contrast holds in both themes.

## Related

- Root `AGENTS.md` §2 (never compromise), §5 (glossary), §7 (hit every surface), §12 (standards)
