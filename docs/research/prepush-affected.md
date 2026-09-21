# Affected pre-push research

Completed source review on origin/main 575afded41e76b86a5633f9def2add3996590841 by Sol, with independent lead review of hook and range boundaries. Current gate infers `@{push}..HEAD` and falls back to full checks for an absent remote feature branch. Existing classifier already handles transitive workspace consumers and unknown paths. Workspace manifests are read from disk, requiring conservative invalidation on graph changes.

Official source: https://lefthook.dev/configuration/use_stdin/ . Multiple jobs cannot each receive Git's stream. Use one consumer and invoke branch protection before selection. Reuse the validated parser and standalone branch-protection contract; preserve receipt handling and lint-once behavior.

Rejected shortcuts: default main, HEAD~1, cached diff, three-dot diff, inference without actual push metadata, default FAST mode. Each can lose changes or coverage. Unsupported non-HEAD/multi-ref updates must not be claimed safe using another checkout's test result.

Implementation and Git-fixture acceptance are recorded in docs/work/2026-09-21-prepush-affected/plan.md and tasks.md. No measured runtime benefit or completed implementation is claimed by this research record.
