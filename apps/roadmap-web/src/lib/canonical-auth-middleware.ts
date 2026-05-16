import { NextResponse, type NextRequest } from 'next/server'

import { readCanonicalAuthClaimsFromRequest } from './canonical-auth'

type CanonicalAuthMiddlewareOptions = {
  secret?: string
}

export async function updateCanonicalAuthSession(
  request: NextRequest,
  options: CanonicalAuthMiddlewareOptions = {},
) {
  if (request.nextUrl.pathname.includes('/mind-maps')) {
    const url = request.nextUrl.clone()
    url.pathname = url.pathname.replace('/mind-maps', '/canvas')
    return NextResponse.redirect(url)
  }

  const authResult = await readCanonicalAuthClaimsFromRequest(request, options)
  const isAuthenticated = authResult.ok
  const isAuthPage =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup')
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/workspaces') ||
    request.nextUrl.pathname.startsWith('/teams')

  if (!isAuthenticated && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (isAuthenticated && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return NextResponse.next({
    request,
  })
}
