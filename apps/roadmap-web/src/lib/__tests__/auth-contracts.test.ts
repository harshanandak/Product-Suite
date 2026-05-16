import { describe, expect, it } from 'vitest'

import { mapSupabaseUserToAuthClaims, resolveWorkspaceAccess } from '../auth-contracts'

describe('roadmap auth contract adapters', () => {
  it('maps a Supabase user to shared auth claims', () => {
    const result = mapSupabaseUserToAuthClaims({
      id: 'user_123',
      email: 'user@example.com',
      user_metadata: {
        full_name: 'User Example',
      },
      app_metadata: {
        provider: 'email',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.claims).toMatchObject({
      provider: 'supabase',
      subject: 'user_123',
      email: 'user@example.com',
      display_name: 'User Example',
    })
  })

  it('denies workspace access when membership is absent', () => {
    expect(
      resolveWorkspaceAccess({
        claims: { provider: 'supabase', subject: 'user_123', workspace_ids: ['workspace_123'] },
        workspaceId: 'workspace_999',
      }),
    ).toEqual({
      ok: false,
      code: 'WORKSPACE_ACCESS_DENIED',
      workspace_id: 'workspace_999',
    })
  })
})
