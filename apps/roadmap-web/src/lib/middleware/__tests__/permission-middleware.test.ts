import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { isUserAdminOrOwner, canUserEditPhase } = vi.hoisted(() => ({
  isUserAdminOrOwner: vi.fn(),
  canUserEditPhase: vi.fn(),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/utils/phase-permissions', () => ({ isUserAdminOrOwner, canUserEditPhase }))

import {
  PermissionDeniedError,
  UnauthenticatedError,
  validateAdminPermission,
  validatePhasePermission,
} from '../permission-middleware'

const CLAIMS = { subject: 'user-1', email: 'u@example.com', provider: 'neon' }
const PARAMS: Parameters<typeof validatePhasePermission>[0] = {
  workspaceId: 'ws-1',
  teamId: 'team-1',
  phase: 'build',
  action: 'edit',
}

describe('validatePhasePermission (canonical auth)', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    isUserAdminOrOwner.mockReset()
    canUserEditPhase.mockReset()
  })

  it('throws UnauthenticatedError when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    await expect(validatePhasePermission(PARAMS)).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('returns the claims-derived user, scoping the admin check by subject', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    isUserAdminOrOwner.mockResolvedValue(true)

    await expect(validatePhasePermission(PARAMS)).resolves.toEqual({
      id: 'user-1',
      email: 'u@example.com',
    })
    expect(isUserAdminOrOwner).toHaveBeenCalledWith('user-1', 'team-1')
  })

  it('throws PermissionDeniedError when the user cannot edit the phase', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    isUserAdminOrOwner.mockResolvedValue(false)
    canUserEditPhase.mockResolvedValue(false)

    await expect(validatePhasePermission(PARAMS)).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})

describe('validateAdminPermission (canonical auth)', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    isUserAdminOrOwner.mockReset()
  })

  it('throws UnauthenticatedError when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    await expect(validateAdminPermission('team-1')).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('returns the claims-derived user for an admin/owner', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    isUserAdminOrOwner.mockResolvedValue(true)

    await expect(validateAdminPermission('team-1')).resolves.toEqual({
      id: 'user-1',
      email: 'u@example.com',
    })
  })

  it('throws PermissionDeniedError for a non-admin', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    isUserAdminOrOwner.mockResolvedValue(false)

    await expect(validateAdminPermission('team-1')).rejects.toBeInstanceOf(PermissionDeniedError)
  })
})
