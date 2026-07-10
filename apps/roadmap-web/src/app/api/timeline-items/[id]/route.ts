import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * GET /api/timeline-items/[id]
 * Get single timeline item by ID
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get user's team
    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Fetch timeline item
    const { data: timelineItem, error: fetchError } = await supabase
      .from('timeline_items')
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        assigned_to_user:users!assigned_to(id, name, email)
      `)
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (fetchError || !timelineItem) {
      return NextResponse.json(
        { error: 'Timeline item not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(timelineItem, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'GET /api/timeline-items/[id]')
  }
}

/**
 * PATCH /api/timeline-items/[id]
 * Update timeline item (including status, progress, assignment, dates, blockers)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const body = await request.json()

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get user's team
    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Verify timeline item exists and belongs to team
    const { data: existingItem, error: checkError } = await supabase
      .from('timeline_items')
      .select('id, team_id')
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (checkError || !existingItem) {
      return NextResponse.json(
        { error: 'Timeline item not found' },
        { status: 404 }
      )
    }

    const {
      description,
      timeline,
      difficulty,
      estimated_hours,
      category,
      integration_type,
      status,
      phase,
      progress_percent,
      assigned_to,
      planned_start_date,
      planned_end_date,
      actual_start_date,
      actual_end_date,
      actual_hours,
      is_blocked,
      blockers,
    } = body

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (description !== undefined) updates.description = description
    if (timeline !== undefined) {
      if (!['MVP', 'SHORT', 'LONG'].includes(timeline)) {
        return NextResponse.json(
          { error: 'timeline must be MVP, SHORT, or LONG' },
          { status: 400 }
        )
      }
      updates.timeline = timeline
    }
    if (difficulty !== undefined) {
      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        return NextResponse.json(
          { error: 'difficulty must be easy, medium, or hard' },
          { status: 400 }
        )
      }
      updates.difficulty = difficulty
    }
    if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours
    if (category !== undefined) updates.category = category
    if (integration_type !== undefined) updates.integration_type = integration_type
    if (status !== undefined) {
      const validStatuses = [
        'not_started',
        'planning',
        'in_progress',
        'blocked',
        'review',
        'completed',
        'on_hold',
        'cancelled',
      ]
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: 'status must be one of: not_started, planning, in_progress, blocked, review, completed, on_hold, cancelled' },
          { status: 400 }
        )
      }
      updates.status = status
    }
    if (phase !== undefined) {
      // Updated 2025-12-13: Migrated to 4-phase system
      const validPhases = ['design', 'build', 'refine', 'launch']
      if (!validPhases.includes(phase)) {
        return NextResponse.json(
          { error: 'phase must be one of: design, build, refine, launch' },
          { status: 400 }
        )
      }
      updates.phase = phase
    }
    if (progress_percent !== undefined) {
      if (progress_percent < 0 || progress_percent > 100) {
        return NextResponse.json(
          { error: 'progress_percent must be between 0 and 100' },
          { status: 400 }
        )
      }
      updates.progress_percent = progress_percent
    }
    if (assigned_to !== undefined) updates.assigned_to = assigned_to
    if (planned_start_date !== undefined) updates.planned_start_date = planned_start_date
    if (planned_end_date !== undefined) updates.planned_end_date = planned_end_date
    if (actual_start_date !== undefined) updates.actual_start_date = actual_start_date
    if (actual_end_date !== undefined) updates.actual_end_date = actual_end_date
    if (actual_hours !== undefined) updates.actual_hours = actual_hours
    if (is_blocked !== undefined) updates.is_blocked = is_blocked
    if (blockers !== undefined) updates.blockers = blockers

    // Update timeline item
    const { data: updatedItem, error: updateError } = await supabase
      .from('timeline_items')
      .update(updates)
      .eq('id', id)
      .eq('team_id', teamId)
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        assigned_to_user:users!assigned_to(id, name, email)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(updatedItem, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/timeline-items/[id]')
  }
}

/**
 * DELETE /api/timeline-items/[id]
 * Delete timeline item
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get user's team
    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Delete timeline item
    const { error: deleteError } = await supabase
      .from('timeline_items')
      .delete()
      .eq('id', id)
      .eq('team_id', teamId)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/timeline-items/[id]')
  }
}
