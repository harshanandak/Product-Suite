import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import type { AuthClaims } from '@product-suite/contracts'

import { getAuthClaims } from './get-auth-claims'

/**
 * Auth guard for API route handlers. Returns the caller's canonical claims, or a
 * ready-to-return 401 `NextResponse` when there is no authenticated user.
 *
 * Usage:
 * ```ts
 * const auth = await requireAuth()
 * if (auth instanceof NextResponse) return auth
 * // auth is AuthClaims here
 * ```
 */
export async function requireAuth(): Promise<AuthClaims | NextResponse> {
  const claims = await getAuthClaims()
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return claims
}

/**
 * Auth + team-membership guard for API route handlers. Verifies the caller is
 * authenticated and a member of `teamId`, returning `{ claims, membership }`, or
 * a ready-to-return 401/403 `NextResponse`.
 *
 * Usage:
 * ```ts
 * const guard = await requireTeamMembership(supabase, teamId)
 * if (guard instanceof NextResponse) return guard
 * const { claims } = guard
 * ```
 */
export async function requireTeamMembership(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{ claims: AuthClaims; membership: { id: string } } | NextResponse> {
  const claims = await getAuthClaims()
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', claims.subject)
    .single<{ id: string }>()

  if (!membership) {
    return NextResponse.json({ error: 'Not a team member' }, { status: 403 })
  }

  return { claims, membership }
}
