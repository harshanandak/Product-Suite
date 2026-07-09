import { verifyToken } from '@clerk/backend'
import type { MiddlewareHandler } from 'hono'

import { validateAuthClaims, type AuthClaims } from '@product-suite/contracts'

export type AuthedEnv = {
  Bindings: {
    CLERK_SECRET_KEY?: string
    CLERK_AUTHORIZED_PARTIES?: string
  }
  Variables: {
    claims: AuthClaims
  }
}

type ClerkJwtPayload = {
  sub: string
  email?: string
  org_id?: string
  exp?: number
  [key: string]: unknown
}

/**
 * Authenticates a request by verifying the Clerk session JWT from the
 * `Authorization: Bearer <token>` header, then exposes the caller's canonical
 * `AuthClaims` on `c.get('claims')`. This is the single API-layer auth gate for
 * the platform API — the one login (Clerk) verified once, mapped to the
 * provider-neutral claims the rest of the app authorizes on.
 *
 * Returns 401 when the token is missing, invalid, or maps to incomplete claims.
 */
export function clerkAuth(): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const secretKey = c.env?.CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY
    const authorizedParties = (c.env?.CLERK_AUTHORIZED_PARTIES ?? process.env.CLERK_AUTHORIZED_PARTIES)
      ?.split(',')
      .map((party) => party.trim())
      .filter(Boolean)

    let payload: ClerkJwtPayload
    try {
      payload = (await verifyToken(token, {
        secretKey,
        authorizedParties: authorizedParties?.length ? authorizedParties : undefined,
      })) as ClerkJwtPayload
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const result = validateAuthClaims({
      provider: 'clerk',
      subject: payload.sub,
      email: payload.email,
      tenant_id: payload.org_id,
      expires_at: payload.exp,
    })

    if (!result.ok) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('claims', result.claims)
    await next()
  }
}
