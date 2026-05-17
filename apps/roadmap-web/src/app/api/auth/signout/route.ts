import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

const DEFAULT_CLAIMS_COOKIE = 'ps_auth_claims'
const DEFAULT_SIGNATURE_COOKIE = 'ps_auth_sig'

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url))

  try {
    const supabase = await createClient()

    // Sign out from Supabase
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Sign out error:', error)
    }
  } catch (error) {
    console.error('Sign out failed:', error)
  }

  // Explicitly clear auth cookies on the response when provider signout propagation fails.
  const cookiesToDelete = new Set(request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith('sb-'))
    .map((cookie) => cookie.name))

  cookiesToDelete.add(
    process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE || DEFAULT_CLAIMS_COOKIE,
  )
  cookiesToDelete.add(
    process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE || DEFAULT_SIGNATURE_COOKIE,
  )

  for (const cookieName of cookiesToDelete) {
    response.cookies.delete(cookieName)
  }

  return response
}

export async function POST(request: NextRequest) {
  return GET(request)
}
