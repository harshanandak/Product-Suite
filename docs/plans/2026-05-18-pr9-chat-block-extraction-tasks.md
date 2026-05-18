# PR9 Chat Block Extraction Tasks

## Task 1: Shared Chat Package Scaffold

RED:
- Add a package test proving `ChatMessageList`, `getChatMessageText`, and `sortChatThreadsByUpdatedAt` are exported.

GREEN:
- Create `packages/ui-chat` with package metadata, source exports, generated JS build, and type declarations.

REFACTOR:
- Keep package exports presentation-only and side-effect-free.

## Task 2: Chat Presentation Block

RED:
- Add package tests for message rendering, role labels, text fallback from `parts`, empty state, and disabled missing-action controls.

GREEN:
- Implement `ChatMessageList` and `ChatThreadList` with conservative markup compatible with both apps.

REFACTOR:
- Keep classes local to the component props and avoid app-specific imports.

## Task 3: Roadmap Chat Helper Adoption

RED:
- Add or update roadmap tests around `use-chat-threads` helper behavior for sorting/normalization.

GREEN:
- Import shared chat types/helpers in `apps/roadmap-web/src/hooks/use-chat-threads.ts` while keeping Supabase operations in roadmap.

REFACTOR:
- Remove duplicated local pure helper logic only where the package now owns it.

## Task 4: Meeting Web Chat Consumer

RED:
- Update meeting-web summary/chat tests to expect discussion chat output through the existing shell.

GREEN:
- Replace `apps/meeting-web/src/components/chat/ChatPanel.jsx` local list markup with `ChatMessageList` from `@product-suite/ui-chat`.

REFACTOR:
- Keep meeting-specific labels/defaults in the meeting shell.

## Task 5: Repo Tooling, CI, And Docs

RED:
- Extend repo-tooling tests so root workspaces, scripts, docs, and CI filters must include `packages/ui-chat`.

GREEN:
- Add root scripts, validation docs, package dependencies, CI path filters, and the PR plan status update.

REFACTOR:
- Keep PR9 plan docs current and avoid unrelated status churn.

## Validation

- `bun run --cwd packages/ui-chat test`
- `bun run --cwd apps/meeting-web test src/__tests__/summaryFirstScreen.test.jsx src/components/meeting/__tests__/SummaryFirstMeetingScreen.test.jsx`
- `bun run --cwd apps/roadmap-web test <focused chat tests>`
- `bun run test:repo-tooling`
- `bun run check:source-test`
