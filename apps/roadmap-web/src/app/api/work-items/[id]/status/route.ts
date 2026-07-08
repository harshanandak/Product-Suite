import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * GET /api/work-items/[id]/status
 * Calculate work item status and progress from timeline items
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

    // Verify work item exists and belongs to team
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, name, type')
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (workItemError || !workItem) {
      return NextResponse.json(
        { error: 'Work item not found' },
        { status: 404 }
      )
    }

    // Use the aggregate function to calculate status
    const { data: statusData, error: statusError } = await supabase
      .rpc('calculate_work_item_status', { p_work_item_id: id })

    if (statusError) {
      console.error('Error calculating status:', statusError)
      // Fall back to manual calculation if function fails
    }

    // Use the aggregate function to calculate progress
    const { data: progressData, error: progressError } = await supabase
      .rpc('calculate_work_item_progress', { p_work_item_id: id })

    if (progressError) {
      console.error('Error calculating progress:', progressError)
    }

    // Fetch timeline items for detailed breakdown
    const { data: timelineItems, error: timelineError } = await supabase
      .from('timeline_items')
      .select('id, timeline, status, progress_percent, is_blocked')
      .eq('work_item_id', id)
      .eq('team_id', teamId)

    if (timelineError) {
      throw timelineError
    }

    // Calculate breakdown by timeline and status
    const breakdown = {
      MVP: { total: 0, completed: 0, in_progress: 0, blocked: 0 },
      SHORT: { total: 0, completed: 0, in_progress: 0, blocked: 0 },
      LONG: { total: 0, completed: 0, in_progress: 0, blocked: 0 },
    }

    timelineItems?.forEach((item) => {
      const timeline = item.timeline as 'MVP' | 'SHORT' | 'LONG'
      breakdown[timeline].total++
      if (item.status === 'completed') breakdown[timeline].completed++
      if (item.status === 'in_progress') breakdown[timeline].in_progress++
      if (item.is_blocked) breakdown[timeline].blocked++
    })

    return NextResponse.json({
      work_item: workItem,
      calculated_status: statusData || 'not_started',
      calculated_progress: progressData || 0,
      timeline_items_count: timelineItems?.length || 0,
      breakdown,
    }, { status: 200 })
  } catch (error: unknown) {
    console.error('Error calculating work item status:', error)
    const message = error instanceof Error ? error.message : 'Failed to calculate work item status'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
