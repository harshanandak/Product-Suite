# Hosted Foundation

The hosted Meeting API baseline uses Neon Auth, Neon Postgres, Cloudflare R2, and app-owned organizations.

Key user flows:

- `/api/auth/session/exchange`
- `/api/auth/onboarding/invitations`
- `/auth/callback`
- `/auth/signed-out`

The hosted bootstrap now relies entirely on the Neon identity exchange path.

## Database migration authority

Neon is the hosted Postgres authority, and Drizzle owns the migration chain at
`packages/db/migrations`. Apply approved hosted changes through the canonical
runner with the direct owner-scoped `MIGRATION_DATABASE_URL`; keep the service
runtime on its pooled `DATABASE_URL`.

The historical files in
`apps/meeting-api/backend/alembic/versions/` and
`apps/meeting-api/backend/migrations/` remain byte-for-byte evidence for audit
and provenance. They are not executable deployment inputs, and no new revision
or raw Meeting migration may be created.
