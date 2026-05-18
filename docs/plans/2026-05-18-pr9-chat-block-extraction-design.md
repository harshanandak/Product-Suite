# PR9 Chat Block Extraction Design

## Feature

- Slug: `pr9-chat-block-extraction`
- Date: 2026-05-18
- Status: planned
- Beads: `product-suite-71k`

## Purpose

Extract the reusable chat presentation and pure chat record helpers into `packages/ui-chat` so Product Suite can reuse chat surfaces across apps without copying UI or data-shape logic.

## Success Criteria

- `packages/ui-chat` exists as a workspace package with tests, build script, types, and React peer dependencies.
- The package exports chat message/thread presentation components and pure helpers only.
- `meeting-web` uses the shared chat message list for its discussion chat slot.
- `roadmap-web` keeps Supabase and AI route wiring in the app, but imports shared chat types/helpers for thread/message behavior.
- Root scripts, validation docs, and CI path filters include `packages/ui-chat`.
- Targeted package, meeting-web, roadmap-web, and repo-tooling tests pass.

## Out Of Scope

- Creating a `chat-web` app.
- Moving Supabase clients, RLS behavior, auth/session handling, or AI API routes into the package.
- Rewriting `chat-interface-v2` or assistant-ui runtime ownership.
- Changing model routing, tool invocation behavior, or streaming protocols.

## Approach Selected

Use a small package-first extraction. The package owns reusable presentation and pure data helpers; app shells keep side effects and service calls.

This is the safest PR9 boundary because it proves reuse in both web apps without forcing roadmap's assistant runtime or Supabase persistence into a shared package prematurely.

## Constraints

- No app aliases such as `@/` inside `packages/ui-chat`.
- No hardcoded Supabase table names in the package.
- No `fetch`, router, auth, or local storage side effects in package exports.
- Preserve existing user-visible chat behavior in both apps.
- Keep generated package JS committed, following the `packages/ui-meeting` pattern.

## Edge Cases

- Messages with `content: null` should render text from `parts` when available.
- Empty message arrays should render an explicit empty state, not a blank panel.
- Thread sorting must not mutate the caller's thread array.
- Missing callbacks should disable interactive controls rather than rendering no-op actions.

## Ambiguity Policy

Use the `/dev` 7-dimension decision gate when implementation details are underspecified. Proceed and document when confidence is at least 80%; stop and ask when confidence is below 80% or when a change would move persistence, auth, routing, or AI orchestration into the package.
