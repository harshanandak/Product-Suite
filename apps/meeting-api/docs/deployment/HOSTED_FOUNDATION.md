# Hosted Foundation

The hosted Meeting API baseline uses Neon Auth, Neon Postgres, Cloudflare R2, and app-owned organizations.

Key user flows:

- `/api/auth/session/exchange`
- `/api/auth/onboarding/invitations`
- `/auth/callback`
- `/auth/signed-out`

The hosted bootstrap now relies entirely on the Neon identity exchange path.
