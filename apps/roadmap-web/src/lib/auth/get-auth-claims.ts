import { cookies } from 'next/headers'

import type { AuthClaims } from '@product-suite/contracts'

import { readCanonicalAuthClaimsFromCookieStore } from '@/lib/canonical-auth'

/**
 * Server-side seam for reading the current user's canonical auth claims.
 *
 * Read-sites (Server Components, Route Handlers, Server Actions) should call
 * this instead of `createClient().auth.getUser()` so they depend only on the
 * provider-neutral `ps_auth_claims` cookie — minted at login by the auth
 * callback (`app/(auth)/auth/callback/route.ts`) and cleared at signout — not
 * on Supabase directly. This is the single seam the Supabase→Neon read-site
 * migration adopts.
 *
 * Returns the validated claims, or `null` when there is no valid canonical
 * session (missing, tampered, or expired).
 */
export async function getAuthClaims(): Promise<AuthClaims | null> {
  const cookieStore = await cookies()
  const result = await readCanonicalAuthClaimsFromCookieStore(cookieStore)
  return result.ok ? result.claims : null
}
