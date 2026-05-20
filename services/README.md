# Services

This directory is reserved for standalone backend runtimes that are not app shells.

During `PR1 Repo Tooling Normalization`, this directory is scaffolding only. It makes the target repo topology explicit without changing current deploy behavior.

Current standalone service ownership:

- `apps/meeting-api/backend`
- `services/agent-core`: owns reusable task-plan execution policy for Roadmap agent workflows without importing app-shell auth, persistence, or route handlers.
- `services/hocuspocus`: owns canonical canvas collaboration transport service wiring without importing app-shell auth, persistence, or route handlers. It exposes a minimal readiness contract for smoke checks without leaking tokens or document context.

Future examples:

- `workflow-core`
