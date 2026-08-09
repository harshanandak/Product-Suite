# Roadmap Supabase Setup — Archived

> **Unsupported legacy application.** This page is retained as a historical
> marker only; it is not a setup guide and must not be used to provision a
> database or credentials.

`apps/roadmap-web` is outside the supported production service set. Its source,
client adapter, and Supabase migration files remain in the repository for
historical/product recovery, but no supported workflow or deployment consumes
them as a database authority.

The supported services use the canonical Neon database contract and the
Drizzle migration plane in `packages/db/migrations`. Migrating Roadmap to the
Platform API, deleting its historical source, or removing external provider
resources is separate work and requires a new approved issue.

Before humans remove any legacy provider secrets, they must prove that no
supported consumer remains and record the evidence in Forge. This repository
does not delete external secrets or projects.
