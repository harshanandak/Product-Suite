# PR3 Schema And Domain Inventory Decisions

## Decision 1
**Date**: 2026-04-24
**Task**: Task 3 - Document Meeting API Canonical Domains And Migration Drift
**Gap**: Meeting API has two checked-in migration sources, but only one can be treated as the canonical ownership reference for PR3.
**Score**: 3 / 14
**Route**: PROCEED
**Choice made**: Use `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py` as the canonical meeting ownership source because it is the newer migration path and contains the user ownership and job tables that the older raw SQL file does not.
**Status**: RESOLVED

## Decision 2
**Date**: 2026-04-24
**Task**: Task 4 - Resolve Shared-Entity Collisions Without Fake Unification
**Gap**: `users`, `chat_messages`, and `artifact` concepts appear across roadmap and meeting surfaces, but they do not represent one shared storage boundary.
**Score**: 3 / 14
**Route**: PROCEED
**Choice made**: Record these overlaps as split concepts with explicit domain boundaries instead of forcing a unified owner in PR3. Roadmap remains authoritative for workspace planning artifacts and chat threads; meeting-api remains authoritative for meeting artifacts and meeting-scoped chat.
**Status**: RESOLVED

## Decision 3
**Date**: 2026-04-24
**Task**: Task 5 - Make The Inventory Discoverable
**Gap**: The repo already has unrelated red baseline areas, so PR3 needed a validation strategy that protects this inventory slice without claiming the entire repo is green.
**Score**: 2 / 14
**Route**: PROCEED
**Choice made**: Validate PR3 with targeted guards in `test/domain-inventory.test.js` plus the existing root repo-tooling guard, and document the scoped validation rationale in the PR.
**Status**: RESOLVED
