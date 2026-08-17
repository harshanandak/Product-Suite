# API Routes

**Scope**: All `/api/*` endpoints. Protected handlers follow this guide; intentionally public and token-authenticated handlers must document their exemption and use their endpoint-specific verification.

## PATTERN

```typescript
// route.ts template
import { createClient } from '@/lib/supabase/server'
import { requireTeamMembership, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const teamId = new URL(request.url).searchParams.get('team_id')
    if (!teamId) {
      return NextResponse.json({ error: 'team_id is required' }, { status: 400 })
    }
    const auth = await requireTeamMembership(supabase, teamId)
    if (auth instanceof NextResponse) return auth

    const { data, error } = await supabase
      .from('table')
      .select('*')
      .eq('team_id', teamId)

    if (error) throw error
    return NextResponse.json({ data })
  } catch (error) {
    return handleRouteError(error, 'API route error')
  }
}
```

## CRITICAL RULES

- **ALWAYS** use `requireAuth()` for protected routes that do not require team membership; do not call `supabase.auth.getUser()` directly.
- **ALWAYS** call `requireTeamMembership()` once when `team_id` comes from the request; it authenticates and verifies membership. When the team is derived from the caller, call `requireAuth()` once, then `resolveCallerTeam(supabase, auth.subject)`.
- **ALWAYS** scope queries to the resource's canonical parent. For a request-supplied `workspace_id`, load its `team_id`, call `requireTeamMembership(supabase, workspace.team_id)`, and filter resource queries by `workspace_id`. Use `resolveCallerTeam()` only when deriving the team from the caller.
- **ALWAYS** document intentionally public or token-authenticated routes and apply their endpoint-specific verification instead of copying the protected pattern.
- **NEVER** return raw Supabase errors to client
- Use `NextResponse.json()` for responses

## ROUTES

| Route | Purpose |
|-------|---------|
| `/api/work-items` | CRUD items |
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
