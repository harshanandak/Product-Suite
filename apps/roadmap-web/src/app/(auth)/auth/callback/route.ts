import { createClient } from '@/lib/supabase/server'
import {
  readCanonicalAuthClaimsFromRequest,
  sealCanonicalAuthClaims,
  type CanonicalAuthResult,
} from '@/lib/canonical-auth'
import { mapSupabaseUserToAuthClaims } from '@/lib/auth-contracts'
import { type AuthClaims } from '@product-suite/contracts'
import { resolveCallbackRedirectPath } from '@/lib/roadmap-auth-routing'
import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const returnTo = requestUrl.searchParams.get('returnTo')
  const supabase = await createClient()
  let claimsResult: CanonicalAuthResult
  let canonicalCookies: Awaited<ReturnType<typeof sealCanonicalAuthClaims>> | null = null

  if (code) {
    const {
      data: { user, session },
      error,
    } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !user || !session?.expires_at) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    claimsResult = mapSupabaseSessionToCanonicalAuthResult(user, session.expires_at)
    if (claimsResult.ok) {
      const canonicalAuthSecret = process.env.ROADMAP_CANONICAL_AUTH_SECRET
      if (!canonicalAuthSecret) {
        return NextResponse.redirect(new URL('/login', request.url))
      }

      canonicalCookies = await sealCanonicalAuthClaims(claimsResult.claims, {
        secret: canonicalAuthSecret,
      })
    }
  } else {
    claimsResult = await readCanonicalAuthClaimsFromRequest(request)
  }

  if (!claimsResult.ok) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: userProfile, error: userProfileError } = await supabase
    .from('users')
    .select('id')
    .eq('id', claimsResult.claims.subject)
    .maybeSingle()
  const { data: teamMember, error: teamMemberError } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', claimsResult.claims.subject)
    .limit(1)
    .maybeSingle()

  if (userProfileError || teamMemberError) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const redirectPath = resolveCallbackRedirectPath({
    claimsResult,
    returnTo,
    hasUserProfile: Boolean(userProfile),
    hasTeamMembership: Boolean(teamMember),
  })

  const response = NextResponse.redirect(new URL(redirectPath, request.url))
  if (canonicalCookies) {
    const cookieExpires = new Date(Number(claimsResult.claims.expires_at) * 1000)
    response.cookies.set(canonicalCookies.claimsCookieName, canonicalCookies.claimsValue, {
      expires: cookieExpires,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: requestUrl.protocol === 'https:',
    })
    response.cookies.set(canonicalCookies.signatureCookieName, canonicalCookies.signatureValue, {
      expires: cookieExpires,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: requestUrl.protocol === 'https:',
    })
  }

  return response
}

function mapSupabaseSessionToCanonicalAuthResult(
  user: Parameters<typeof mapSupabaseUserToAuthClaims>[0],
  expiresAt: AuthClaims['expires_at'],
): CanonicalAuthResult {
  const mappedClaims = mapSupabaseUserToAuthClaims(user)

  if (!mappedClaims.ok) {
    return {
      ok: false,
      error: {
        code: 'CANONICAL_AUTH_SESSION_INVALID',
        missing: mappedClaims.error.missing,
      },
    }
  }

  return {
    ok: true,
    claims: {
      ...mappedClaims.claims,
      expires_at: expiresAt,
    },
  }
}
