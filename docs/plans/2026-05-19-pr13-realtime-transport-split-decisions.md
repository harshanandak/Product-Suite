# PR13 Realtime Transport Split Decisions

Beads: `product-suite-6w3`

## Task 1: Runnable service registration

- Gap: Task 1 registers `bun run test:hocuspocus` in pre-push before Task 2 fills the service contracts.
- Score: 2/14, PROCEED.
- Choice: Add a minimal private `services/hocuspocus` workspace with a smoke test now, then replace the placeholder surface with contract-backed transport code in Task 2.
