import { createClient } from '@/lib/supabase/server'
import { readCanonicalAuthClaimsFromRequest } from '@/lib/canonical-auth'
import { resolveCallbackRedirectPath } from '@/lib/roadmap-auth-routing'
import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const returnTo = requestUrl.searchParams.get('returnTo')
  const claimsResult = await readCanonicalAuthClaimsFromRequest(request)

  if (!claimsResult.ok) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const supabase = await createClient()
  const { data: userProfile } = await supabase
    .from('users')
    .select('id')
    .eq('id', claimsResult.claims.subject)
    .single()
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', claimsResult.claims.subject)
    .limit(1)
    .single()

  const redirectPath = resolveCallbackRedirectPath({
    claimsResult,
    returnTo,
    hasUserProfile: Boolean(userProfile),
    hasTeamMembership: Boolean(teamMember),
  })

  return NextResponse.redirect(new URL(redirectPath, request.url))
}
