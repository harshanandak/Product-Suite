import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireTeamMembership, handleRouteError } from '@/lib/auth/api-guard'

/**
 * GET /api/team/members?team_id=xxx
 * List all team members with their phase assignments
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get team_id from query params
    const searchParams = request.nextUrl.searchParams
    const team_id = searchParams.get('team_id')

    if (!team_id) {
      return NextResponse.json(
        { error: 'team_id is required', success: false },
        { status: 400 }
      )
    }

    // Auth + team-membership guard (see lib/auth/api-guard)
    const guard = await requireTeamMembership(supabase, team_id)
    if (guard instanceof NextResponse) return guard

    // Get all team members with user details
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select(`
        id,
        user_id,
        role,
        joined_at,
        users:users!team_members_user_id_fkey(
          id,
          email,
          name,
          avatar_url
        )
      `)
      .eq('team_id', team_id)
      .order('joined_at', { ascending: true })

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return NextResponse.json(
        { error: 'Failed to fetch team members', details: membersError.message, success: false },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: members,
      success: true
    })

  } catch (error) {
    return handleRouteError(error, 'Error in GET /api/team/members')
  }
}
