# PR9 Chat Block Extraction Research

Date: 2026-05-18

## Scope Verified

- `docs/plans/building-blocks-transformation-pr-plan.md` names `PR9 Chat Block Extraction` after merged PR8.
- GitHub PR #9 merged PR8 into `main` on 2026-05-18.
- Beads issue `product-suite-71k` tracks this PR9 slice.

## Codebase Findings

- `apps/roadmap-web/src/hooks/use-chat-threads.ts` owns Supabase-backed thread/message persistence and exports the durable chat record shapes.
- `apps/roadmap-web/src/components/ai/chat-interface-v2.tsx` consumes `useCurrentThread` and `useMessages`, but also performs app-specific Supabase writes and calls `/api/ai/unified-chat`.
- `apps/roadmap-web/src/components/ai/chat-panel.tsx` owns a separate AI SDK chat surface that calls `/api/ai/sdk-chat` and uses roadmap-local shadcn components.
- `apps/meeting-web/src/components/chat/ChatPanel.jsx` is a small presentation-only discussion list currently suitable for package extraction.
- PR9 should not move Supabase clients, workspace routing, assistant runtime orchestration, or AI API calls into a shared package.

## Technical Approach

Create `packages/ui-chat` as a React package with no router, Supabase, AI SDK, auth, or persistence dependencies. The initial public API should expose:

- `ChatMessageList`
- `ChatThreadList`
- `getChatMessageText`
- `sortChatThreadsByUpdatedAt`
- shared `ChatMessage` and `ChatThread` types

`meeting-web` should replace its local chat list rendering with `ChatMessageList`.

`roadmap-web` should keep the Supabase hook and API routes in the app shell, but import shared chat types and pure helpers from `@product-suite/ui-chat` so thread/message data behavior is not forked.

## TDD Scenarios

1. Package smoke test renders chat messages with role labels, text fallback from `parts`, and an empty state.
2. Package helper test sorts active threads by `updated_at` descending without mutating the input.
3. Package helper test resolves message text from `content` first, then text parts, then an empty string.
4. Meeting-web test verifies the existing summary screen still renders discussion chat through the shared package.
5. Roadmap-web test verifies `use-chat-threads` imports and uses shared package helpers/types without moving Supabase wiring into the package.
6. Repo-tooling test verifies `packages/ui-chat` is wired into workspaces, scripts, CI path filters, and validation docs.

## Risks

- Pulling app-specific persistence into the package would make the package roadmap-only.
- Extracting the assistant-ui runtime in this slice would be too broad and likely collide with later agent-core work.
- Duplicating chat record types in app code and the package would make future service extraction harder.
