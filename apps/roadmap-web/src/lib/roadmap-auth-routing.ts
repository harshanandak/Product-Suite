import type { CanonicalAuthResult } from './canonical-auth'

export function resolveHomeRedirectPath(claimsResult: CanonicalAuthResult) {
  return claimsResult.ok ? '/dashboard' : null
}

export function resolveCallbackRedirectPath({
  claimsResult,
  returnTo,
  hasUserProfile,
  hasTeamMembership,
}: {
  claimsResult: CanonicalAuthResult
  returnTo?: string | null
  hasUserProfile?: boolean
  hasTeamMembership?: boolean
}) {
  if (!claimsResult.ok) {
    return '/login'
  }

  const safeReturnPath = resolveSafeReturnPath(returnTo)
  if (safeReturnPath) {
    return safeReturnPath
  }

  if (hasUserProfile === false || hasTeamMembership === false) {
    return '/onboarding'
  }

  return '/dashboard'
}

function resolveSafeReturnPath(returnTo?: string | null) {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return null
  }

  return returnTo
}
