import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * GET /api/work-items/[id]/children
 * Get all children of a work item (for hierarchy display)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get user's team
    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Verify parent work item exists and belongs to team
    const { data: parentItem, error: parentError } = await supabase
      .from('work_items')
      .select('id, name, type, is_epic')
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (parentError || !parentItem) {
      return NextResponse.json(
        { error: 'Work item not found' },
        { status: 404 }
      )
    }

    // Fetch all children
    const { data: children, error: fetchError } = await supabase
      .from('work_items')
      .select('id, name, type, is_epic, parent_id, created_at, updated_at')
      .eq('parent_id', id)
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })

    if (fetchError) {
      throw fetchError
    }

    return NextResponse.json({
      parent: parentItem,
      children: children || [],
      count: children?.length || 0,
    }, { status: 200 })
  } catch (error: unknown) {
    console.error('Error fetching work item children:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch work item children' },
      { status: 500 }
    )
  }
}
