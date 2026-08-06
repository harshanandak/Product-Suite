# Agent-editable workspace foundation - dev decisions

Issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`

This log records specification gaps and evidence-driven choices made during the
BlockSuite rejection spike and subsequent implementation tasks.

## D1 - BlockSuite remains a conditional dependency

- Evidence: with BlockSuite `0.19.5`, ordinary block changes update `Doc.spaceDoc`; the
  current `SimpleCanvas` provider observes `collection.doc`. Root-only encode/apply loses
  paragraph IDs and content, while root plus `spaceDoc` preserves them.
- Result: the current Product-Suite integration fails gates 3, 8, and 10. This rejects the
  current seam, not BlockSuite itself. Continue only with the 2-3 engineer-week
  kill-or-continue spike.
- Route: PROCEED. The RED test belongs in Task 4; no production fix is authorized yet.

## D2 - Import exactly; do not fork

- Decision: if the spike passes, exact-pin all `@blocksuite/*` packages to the same proven
  release and use public APIs only. Small necessary patches require an upstream issue, test,
  owner, and expiry.
- Reason: MPL-2.0 permits Product use, but a fork converts upgrades, security maintenance,
  and browser/editor compatibility into permanent Product-Suite ownership.
- Revisit: fork only if upstream is abandoned and Product explicitly funds that ownership.

## D3 - BlockSuite plus Mermaid is the MVP drawing boundary

- Decision: do not add Excalidraw now. BlockSuite page/edgeless plus Mermaid covers documents,
  spatial blocks, structured diagrams, and agent-authored charts.
- Revisit: add Excalidraw as an artifact adapter only for measured demand for `.excalidraw`
  interop, rough freehand UX, libraries, editable Mermaid scenes, or Excalidraw collaboration.

## D4 - Dependency economics is a release gate

Every candidate must record license/source availability, direct vendor price, integration
effort, recurring operations, data retention/egress exposure, upgrade burden, and replacement
cost. Estimates and official sources are maintained in
`docs/architecture/agentic-workspace-dependency-economics.md`.

## D5 - Collaboration and meeting boundaries

- A Product-owned `Actor`/`Conversation`/`Membership`/`ConversationEvent` fabric unifies
  humans and agents in the UX. `Actor` never replaces security principal or delegation
  authority.
- Product-hosted rooms use `RoomProvider`; joining external Meet/Teams/Zoom uses a separate
  `ExternalMeetingConnector`; talkback uses `RealtimeAgentAdapter`.
- MVP direction: local capture first, optional Recall.ai for cross-provider visible bots,
  Zoom RTMS next, and Google Meet REST for post-meeting artifacts. Native Teams media bots and
  Meet Media API remain deferred.

## D6 - Forge stage-adapter failure is separate from product scope

`forge dev` moved the issue to dev before its legacy audit projection failed because Dolt
database `product_suite` was absent. Tracked as Forge issue
`9e83fd92-82c8-482a-bffd-8f6197736204`; it does not change this architecture decision.
