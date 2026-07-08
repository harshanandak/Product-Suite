import { cookies } from 'next/headers'

import type { AuthClaims } from '@product-suite/contracts'

import { mapSupabaseUserToAuthClaims } from '@/lib/auth-contracts'
import { readCanonicalAuthClaimsFromCookieStore } from '@/lib/canonical-auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Server-side seam for reading the current user's canonical auth claims.
 *
 * Read-sites (Server Components, Route Handlers, Server Actions) should call
 * this instead of `createClient().auth.getUser()` so they depend only on the
 * provider-neutral `ps_auth_claims` cookie — minted at login by the auth
 * callback (`app/(auth)/auth/callback/route.ts`) and cleared at signout. This is
 * the single seam the Supabase→Neon read-site migration adopts.
 *
 * Returns the validated claims, or `null` when there is no authenticated user.
 */
export async function getAuthClaims(): Promise<AuthClaims | null> {
  const cookieStore = await cookies()
  const result = await readCanonicalAuthClaimsFromCookieStore(cookieStore)
  if (result.ok) {
    return result.claims
  }

  // Transitional fallback — the ONE place a read-site path still touches
  // Supabase, removed once the canonical minter owns session freshness
  // end-to-end. The `ps_auth_claims` cookie is sealed at login with the
  // Supabase access-token expiry (~1h), but middleware keeps the Supabase
  // session alive by refreshing it, so the cookie lapses mid-session. When it
  // has, re-derive claims from the still-valid Supabase session so migrated
  // read-sites don't spuriously log the user out.
  return getAuthClaimsFromSupabaseSession()
}

async function getAuthClaimsFromSupabaseSession(): Promise<AuthClaims | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return null
  }

  const mapped = mapSupabaseUserToAuthClaims(user)
  if (!mapped.ok) {
    return null
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.expires_at
    ? { ...mapped.claims, expires_at: session.expires_at }
    : mapped.claims
}
