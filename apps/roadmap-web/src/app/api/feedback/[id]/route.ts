import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * GET /api/feedback/[id]
 * Get single feedback by ID
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth guard (see lib/auth/api-guard)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Fetch feedback
    const { data: feedback, error: fetchError } = await supabase
      .from('feedback')
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        implemented_in:work_items!implemented_in_id(id, name, type),
        decision_by_user:users!decision_by(id, name, email)
      `)
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (fetchError || !feedback) {
      return NextResponse.json(
        { error: 'Feedback not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(feedback, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Error fetching feedback')
  }
}

/**
 * PATCH /api/feedback/[id]
 * Update feedback
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const body = await request.json()

    // Auth guard (see lib/auth/api-guard)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Verify feedback exists and belongs to team
    const { data: existingFeedback, error: checkError } = await supabase
      .from('feedback')
      .select('id, team_id')
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (checkError || !existingFeedback) {
      return NextResponse.json(
        { error: 'Feedback not found' },
        { status: 404 }
      )
    }

    const {
      source,
      source_name,
      source_role,
      source_email,
      priority,
      content,
      context,
    } = body

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (source !== undefined) {
      if (!['internal', 'customer', 'user'].includes(source)) {
        return NextResponse.json(
          { error: 'source must be internal, customer, or user' },
          { status: 400 }
        )
      }
      updates.source = source
    }
    if (source_name !== undefined) updates.source_name = source_name
    if (source_role !== undefined) updates.source_role = source_role
    if (source_email !== undefined) updates.source_email = source_email
    if (priority !== undefined) {
      if (!['high', 'low'].includes(priority)) {
        return NextResponse.json(
          { error: 'priority must be high or low' },
          { status: 400 }
        )
      }
      updates.priority = priority
    }
    if (content !== undefined) updates.content = content
    if (context !== undefined) updates.context = context

    // Update feedback
    const { data: updatedFeedback, error: updateError } = await supabase
      .from('feedback')
      .update(updates)
      .eq('id', id)
      .eq('team_id', teamId)
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        implemented_in:work_items!implemented_in_id(id, name, type),
        decision_by_user:users!decision_by(id, name, email)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(updatedFeedback, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Error updating feedback')
  }
}

/**
 * DELETE /api/feedback/[id]
 * Delete feedback
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth guard (see lib/auth/api-guard)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Delete feedback
    const { error: deleteError } = await supabase
      .from('feedback')
      .delete()
      .eq('id', id)
      .eq('team_id', teamId)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Error deleting feedback')
  }
}
