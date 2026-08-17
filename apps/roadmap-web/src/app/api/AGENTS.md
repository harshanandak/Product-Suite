# API Routes

**Scope**: All `/api/*` endpoints. Protected handlers follow this guide; intentionally public and token-authenticated handlers must document their exemption and use their endpoint-specific verification.

## PATTERN

```typescript
// route.ts template
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireTeamMembership, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  const teamId = new URL(request.url).searchParams.get('team_id')
  if (!teamId) {
    return NextResponse.json({ error: 'team_id is required' }, { status: 400 })
  }
  const membership = await requireTeamMembership(supabase, teamId)
  if (membership instanceof NextResponse) return membership

  const { data, error } = await supabase
    .from('table')
    .select('*')
    .eq('team_id', teamId)
  
  if (error) throw error
  return NextResponse.json({ data })
}
```

## CRITICAL RULES

- **ALWAYS** use `requireAuth()` for protected routes; do not call `supabase.auth.getUser()` directly.
- **ALWAYS** verify team membership with `requireTeamMembership()` when `team_id` comes from the request. When the team is derived from the caller, use `resolveCallerTeam()` with `auth.subject`.
- **ALWAYS** scope queries to the resource's canonical parent. Use `team_id` only for team-owned tables; workspace-owned resources must verify workspace membership and filter by `workspace_id`.
- **ALWAYS** document intentionally public or token-authenticated routes and apply their endpoint-specific verification instead of copying the protected pattern.
- **NEVER** return raw Supabase errors to client
- Use `NextResponse.json()` for responses

## ROUTES

| Route | Purpose |
|-------|---------|
| `/api/work-items` | CRUD work items |
| `/api/workspaces` | Workspace management |
| `/api/team/*` | Team, members, invites |
| `/api/ai/*` | AI chat, suggestions |
| `/api/resources` | Resource linking |

## ERROR HANDLING

```typescript
try {
  // operation
} catch (error) {
  console.error('Context:', error)
  return NextResponse.json(
    { error: 'User-friendly message' },
    { status: 500 }
  )
}
```
