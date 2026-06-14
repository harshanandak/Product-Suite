import { NextResponse, type NextRequest } from 'next/server'

import { readCanonicalAuthClaimsFromRequest } from './canonical-auth'
import {
  buildPlatformLoginRedirectPath,
  isAuthOnlyRoute,
  isProtectedPlatformRoute,
} from './platform/auth-route-compatibility'

type CanonicalAuthMiddlewareOptions = {
  response?: NextResponse
  secret?: string
}

export async function updateCanonicalAuthSession(
  request: NextRequest,
  options: CanonicalAuthMiddlewareOptions = {},
) {
  if (request.nextUrl.pathname.includes('/mind-maps')) {
    const url = request.nextUrl.clone()
    url.pathname = url.pathname.replace('/mind-maps', '/canvas')
    return preserveResponseCookies(NextResponse.redirect(url), options.response)
  }

  const authResult = await readCanonicalAuthClaimsFromRequest(request, options)
  const isAuthenticated = authResult.ok
  const isAuthPage =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup') ||
    isAuthOnlyRoute(request.nextUrl.pathname)
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/workspaces') ||
    request.nextUrl.pathname.startsWith('/teams') ||
    isProtectedPlatformRoute(request.nextUrl.pathname)
  const isIncomingAuthCallback =
    request.nextUrl.pathname === '/auth/callback' && request.nextUrl.searchParams.has('code')

  if (!isAuthenticated && isProtectedRoute) {
    const url = request.nextUrl.clone()
    const loginPath = buildPlatformLoginRedirectPath(
      request.nextUrl.pathname,
      request.nextUrl.search,
    )
    url.pathname = loginPath.split('?')[0] ?? '/login'
    url.search = loginPath.includes('?') ? `?${loginPath.split('?')[1]}` : ''
    return preserveResponseCookies(NextResponse.redirect(url), options.response)
  }

  if (isAuthenticated && isAuthPage && !isIncomingAuthCallback) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return preserveResponseCookies(NextResponse.redirect(url), options.response)
  }

  return preserveResponseCookies(
    NextResponse.next({
      request,
    }),
    options.response,
  )
}

function preserveResponseCookies(response: NextResponse, sourceResponse?: NextResponse) {
  sourceResponse?.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })

  return response
}
