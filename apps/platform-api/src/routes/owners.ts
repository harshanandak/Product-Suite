import { Hono } from 'hono'

import type { Owner } from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped owners query (`users` is Alembic-owned). */
interface OwnerRow {
  id: string
  name: string | null
  email: string
}

/** First letters of the first two words, else first two chars — upper-cased. */
function initialsFrom(label: string): string {
  const trimmed = label.trim()
  const [first, second] = trimmed.split(/\s+/).filter(Boolean)
  if (first && second) return (first.charAt(0) + second.charAt(0)).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

function toOwner(row: OwnerRow): Owner {
  // `users.name` is nullable — fall back to the email local part for display.
  const label = row.name?.trim() || row.email
  return {
    id: row.id,
    name: label,
    initials: initialsFrom(label),
  }
}

export const ownersRoutes = new Hono<AuthedEnv>()

/**
 * List the assignable owners the caller can see — the active members of the
 * tenants the caller is themselves an active member of. Sourced from the
 * Alembic-owned `users` + `organization_memberships`; a work item's
 * `assignee_id` resolves to one of these.
 */
ownersRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: OwnerRow[]
  try {
    rows = (await sql`
      select distinct u.id, u.name, u.email
      from users u
      join organization_memberships om on om.user_id = u.id
      where om.status = 'active'
        and om.tenant_id in (
          select om2.tenant_id
          from organization_memberships om2
          join user_auth_identities uai on uai.user_id = om2.user_id
          where uai.provider = 'clerk'
            and uai.provider_user_id = ${claims.subject}
            and om2.status = 'active'
        )
      order by u.name
    `) as OwnerRow[]
  } catch (cause) {
    console.error('[owners] list query failed', cause)
    return c.json({ error: 'Failed to load owners' }, 500)
  }

  return c.json(rows.map(toOwner))
})
