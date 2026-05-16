import { validateAuthClaims, type AuthClaims } from '@product-suite/contracts'

type SupabaseUserLike = {
  id?: string
  email?: string
  user_metadata?: {
    full_name?: string
    name?: string
    display_name?: string
  }
  app_metadata?: {
    provider?: string
    providers?: string[]
  }
}

export function mapSupabaseUserToAuthClaims(user: SupabaseUserLike | null | undefined) {
  return validateAuthClaims({
    provider: 'supabase',
    subject: user?.id,
    email: user?.email,
    display_name:
      user?.user_metadata?.full_name ??
      user?.user_metadata?.name ??
      user?.user_metadata?.display_name,
    provider_claims: {
      provider: user?.app_metadata?.provider,
      providers: user?.app_metadata?.providers,
    },
  })
}

export function resolveWorkspaceAccess({
  claims,
  workspaceId,
}: {
  claims: Pick<AuthClaims, 'workspace_ids'>
  workspaceId: string
}) {
  if (claims.workspace_ids?.includes(workspaceId)) {
    return {
      ok: true,
      workspace_id: workspaceId,
    }
  }

  return {
    ok: false,
    code: 'WORKSPACE_ACCESS_DENIED',
    workspace_id: workspaceId,
  }
}
