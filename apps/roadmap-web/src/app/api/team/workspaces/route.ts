import { createClient } from '@/lib/supabase/server'
import { requireTeamMembership, handleRouteError } from '@/lib/auth/api-guard'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/team/workspaces
 * Fetch all workspaces for a team
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get team_id from query params
    const searchParams = request.nextUrl.searchParams
    const teamId = searchParams.get('team_id')

    if (!teamId) {
      return NextResponse.json({ error: 'team_id is required' }, { status: 400 })
    }

    // Auth + team-membership guard (see lib/auth/api-guard)
    const guard = await requireTeamMembership(supabase, teamId)
    if (guard instanceof NextResponse) return guard

    // Fetch all workspaces for this team
    const { data: workspaces, error: workspacesError } = await supabase
      .from('workspaces')
      .select('id, name, description, phase, created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })

    if (workspacesError) {
      console.error('Error fetching workspaces:', workspacesError)
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
    }

    return NextResponse.json(workspaces || [])
  } catch (error) {
    return handleRouteError(error, 'Error in GET /api/team/workspaces')
  }
}
