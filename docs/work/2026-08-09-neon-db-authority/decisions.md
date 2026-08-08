# Decisions: canonical Neon database authority

## Task 1 - URL validation stays structural and redacted

**Decision:** Validate only the Neon hostname shape, TLS, database name, project
and branch identifiers, declared URL purpose, and the environment-pinned history
variant. The validator accepts secrets exclusively from process environment
variables and never includes connection strings, user names, passwords, or query
parameters in an error or report.

**Reason:** This makes provider and topology drift fail before a client is created
without creating a new path for secrets to reach CLI logs.

**Scope:** Task 1 only.
