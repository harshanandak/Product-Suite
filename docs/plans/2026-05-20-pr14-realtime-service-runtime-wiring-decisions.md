# PR14 Realtime Service Runtime Wiring Decisions

Feature: `pr14-realtime-service-runtime-wiring`
Beads: `product-suite-36p`

## Decision 1
**Date**: 2026-05-20
**Task**: Task 2 - Add Hocuspocus Runtime Entrypoint
**Gap**: The design required validated startup but did not specify whether validation should live in the runtime wrapper or server factory.
**Score**: 2 / 14
**Route**: PROCEED
**Choice made**: Runtime startup resolves and validates environment config before constructing the server, so invalid ports or debounce values fail before `listen()` can open a socket.
**Status**: RESOLVED

## Decision 2
**Date**: 2026-05-20
**Task**: Task 3 - Add Health And Readiness Surface
**Gap**: The design required smoke-check readiness without specifying the shape of the readiness payload.
**Score**: 2 / 14
**Route**: PROCEED
**Choice made**: The readiness contract reports only service name, ready state, port, and address. It intentionally excludes tokens, document ids, auth context, and persistence payloads.
**Status**: RESOLVED

## Decision 3
**Date**: 2026-05-20
**Task**: Task 4 - Wire Roadmap Runtime Selection Without Cutover
**Gap**: The design did not define the minimum inputs needed before Roadmap may select Hocuspocus.
**Score**: 3 / 14
**Route**: PROCEED
**Choice made**: Roadmap selects Hocuspocus only when the service URL, synchronous non-empty token factory, and connection factory are all provided. This keeps partial configuration from producing a broken realtime path.
**Status**: RESOLVED

## Decision 4
**Date**: 2026-05-20
**Task**: Task 4 - Wire Roadmap Runtime Selection Without Cutover
**Gap**: The design required preserving fallback behavior but did not specify whether Supabase should remain the default when only some Hocuspocus inputs exist.
**Score**: 1 / 14
**Route**: PROCEED
**Choice made**: Supabase Realtime remains the default and fallback unless the Hocuspocus selection inputs are complete. This keeps the PR as runtime wiring only, not a provider cutover.
**Status**: RESOLVED
