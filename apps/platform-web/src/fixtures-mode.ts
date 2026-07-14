/**
 * DEV-ONLY fixtures / preview mode toggle.
 *
 * When `true`, the app serves in-memory FIXTURE data and renders the shell
 * WITHOUT the Clerk auth gate, so a developer can visually review the Workboard
 * and the review inbox with `bun run dev:fixtures` — no backend API, no Clerk
 * publishable key, and no real agent proposals required.
 *
 * ── PROD SAFETY (non-negotiable) ────────────────────────────────────────────
 * The toggle requires BOTH `import.meta.env.DEV` AND
 * `VITE_USE_FIXTURES === "true"`. Vite hard-codes `import.meta.env.DEV` to the
 * literal `false` in any production build (`vite build`), so this whole
 * expression constant-folds to `false` at build time. Every `if (USE_FIXTURES)`
 * / ternary branch guarded by it — including the Clerk auth bypass and the
 * fixture-repository selection — is then DEAD-CODE-ELIMINATED from the
 * production bundle. A production build can therefore NEVER bypass Clerk or
 * serve fixtures: the bypass is not merely disabled, it is absent from the
 * shipped JavaScript.
 *
 * Verify: `bun run build` then grep `dist/` — the string `VITE_USE_FIXTURES`
 * and the fixture branches are gone.
 */
export const USE_FIXTURES: boolean =
  import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === "true";
