# PR4 Contracts Nucleus Design

Feature: `pr4-contracts-nucleus`
Date: 2026-04-24
Status: planned

## Purpose

Create the smallest possible shared contracts nucleus so `roadmap-web`, `meeting-web`, and `meeting-api` stop hand-rolling overlapping wire shapes before PR5/PR6 auth convergence and PR7 SDK work.

## Success Criteria

- `packages/contracts` exists and is consumable by both JS apps as a package import.
- The contracts surface is limited to:
  - identity scope
  - conversation
  - meeting core
  - canvas core
- `meeting-api` validates its exposed runtime/wire payloads against the same contract artifacts rather than a parallel hand-written shape.
- No app-local schema owner is replaced or implied to be shared when PR3 said it is domain-local.
- Root validation and CI include guard coverage for the new contracts package wiring.

## Out Of Scope

- auth provider migration
- provider adapter rollout
- SDK or typed HTTP client generation
- task/workflow/webhook contracts
- schema ownership unification
- package extraction for UI blocks
- realtime transport changes

## Approach Options

### Option A: TypeScript-only contracts package

Pros:
- fastest for the JS apps

Cons:
- not a real shared contract for Python
- backend would still duplicate shape assertions

### Option B: OpenAPI-first or protobuf-style contract layer

Pros:
- cross-language by design

Cons:
- too heavy for PR4
- expands scope into transport and client generation too early

### Option C: JSON-contract-first nucleus with JS exports and Python fixture validation

Pros:
- cross-language enough for this repo
- keeps PR4 focused on wire shapes, not clients
- lets JS apps import package helpers while Python reads the same canonical artifacts from disk

Cons:
- requires disciplined package layout
- some duplication between TS helper types and JSON fixture exports is still possible

## Approach Selected

Use **Option C**.

`packages/contracts` will be authored as a minimal shared artifact package that:

- exposes package imports for `roadmap-web` and `meeting-web`
- keeps the source-of-truth shapes serializable and inspectable
- gives `meeting-api` a contract artifact it can validate against in tests without pretending Python imports TypeScript

This is the narrowest approach that is still honest for all three deployables.

## Constraints

- PR3 ownership boundaries remain authoritative.
- `thread` means roadmap workspace-thread semantics, not meeting chat semantics.
- `artifact` stays split by type; PR4 may only describe the minimal canvas artifact surface needed for shared wire use.
- `meeting-web` must consume runnable JS, not TS-only path aliases.
- The backend cannot depend on a Node build step at runtime.

## Edge Cases

- If a candidate contract depends on roadmap Supabase table details or meeting-api repository fields directly, it is too deep for PR4 and must stay local.
- If a contract name overlaps across domains but the resource scope differs, PR4 must use different envelopes or explicit names instead of flattening them together.
- If `packages/contracts` requires generated code to be usable in Python tests, the package is too heavy for this slice.
- If adding the package forces cascading import rewrites across all apps, PR4 should stop at the thinnest working adoption path and push broader cleanup to PR7.

## Ambiguity Policy

Use the existing decision-gate rule:

- `>= 80%` confidence: proceed and document in the decisions log
- `< 80%` confidence: stop and ask before freezing the contract shape

## Technical Research

### Verified seams

- `apps/meeting-api/backend/routes/runtime.py` defines the current runtime config wire payload.
- `apps/meeting-web/src/lib/api.js` consumes the hosted auth/runtime subset of that payload.
- `apps/roadmap-web/src/lib/supabase/types.ts` contains the canonical wire tables for roadmap chat and blocksuite document artifacts.
- The root workspace list still needs package wiring for `packages/contracts`.

### OWASP Top 10 Notes

- `A01 Broken Access Control`
  - applies
  - mitigation: PR4 shares only scope/claims shape, not authorization logic or role evaluation
- `A04 Insecure Design`
  - applies
  - mitigation: keep contracts wire-level and domain-bounded; do not freeze a false shared domain model
- `A05 Security Misconfiguration`
  - applies
  - mitigation: package must not require secret-bearing build/runtime config to be imported
- `A06 Vulnerable And Outdated Components`
  - low relevance
  - mitigation: prefer existing repo dependencies and plain JSON/JS exports over new codegen stacks
- `A08 Software And Data Integrity Failures`
  - applies
  - mitigation: add repo guard tests so workflow/package drift cannot silently bypass contract validation

### TDD Scenarios

1. Happy path: JS apps import the contracts package and consume the identity/conversation/meeting/canvas exports.
2. Failure path: repo guard fails if workflow or workspace wiring skips the new contracts package.
3. Edge case: backend contract validation fails when runtime payload shape diverges from the canonical contracts artifact.
