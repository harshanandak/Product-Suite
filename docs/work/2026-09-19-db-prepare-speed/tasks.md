# DB Contract redundant prepare reduction - tasks

## Task 1 - lock one transactional resource per routed suite

1. Add an AST-backed assertion to `topology.test.ts` that each routed suite with transactional assertions has exactly one `withTransactionalDb` factory.
2. Run the focused topology test and capture the expected failure for `accept-path` and `meeting-ingest`.

## Task 2 - consolidate the two transactional tails

1. Move `accept-path:9` into the existing `accept-path` transactional scope and remove `accept-path-tail`.
2. Move `meeting-ingest:5` into the existing `meeting-ingest` transactional scope and remove `meeting-ingest-tail`.
3. Leave all dedicated assertions and helpers unchanged.
4. Run the focused topology and suite-resource tests and capture passing output.

## Task 3 - self-review and handoff

1. Read `CODING_STANDARDS.md`, inspect the final diff, and verify all 57 manifest entries remain unchanged.
2. Commit the focused change without pushing.
3. Return RED/GREEN evidence and the exact commit to the lead for independent spec and quality review.
