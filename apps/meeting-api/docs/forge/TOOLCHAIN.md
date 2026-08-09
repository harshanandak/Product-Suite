# Meeting API Toolchain

Meeting API local development uses Python 3.13, pytest, and the hosted auth/storage stack described in the deployment docs. Database schema changes are owned by Drizzle in `packages/db/migrations`; retained legacy migration files are historical evidence and are not run.
