import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * POST /api/feedback/[id]/convert
 * Convert feedback into a work item
 */
export async function POST(
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

    const { work_item_type, work_item_name, work_item_purpose } = body

    // Validate work item type
    if (!work_item_type || !['concept', 'feature', 'bug', 'enhancement'].includes(work_item_type)) {
      return NextResponse.json(
        { error: 'work_item_type must be concept, feature, bug, or enhancement' },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!work_item_name) {
      return NextResponse.json(
        { error: 'work_item_name is required' },
        { status: 400 }
      )
    }

    // Verify feedback exists and belongs to team
    const { data: existingFeedback, error: checkError } = await supabase
      .from('feedback')
      .select('id, team_id, workspace_id, content, status')
      .eq('id', id)
      .eq('team_id', teamId)
      .single()

    if (checkError || !existingFeedback) {
      return NextResponse.json(
        { error: 'Feedback not found' },
        { status: 404 }
      )
    }

    // Create new work item
    const workItemId = Date.now().toString()
    const workItem = {
      id: workItemId,
      name: work_item_name,
      type: work_item_type,
      purpose: work_item_purpose || existingFeedback.content,
      team_id: teamId,
      workspace_id: existingFeedback.workspace_id,
      owner: claims.subject,
      is_epic: false,
      parent_id: null,
    }

    const { data: newWorkItem, error: createError } = await supabase
      .from('work_items')
      .insert(workItem)
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Update feedback to mark as implemented
    const { data: updatedFeedback, error: updateError } = await supabase
      .from('feedback')
      .update({
        implemented_in_id: workItemId,
        status: 'implemented',
        updated_at: new Date().toISOString(),
      })
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

    return NextResponse.json(
      {
        feedback: updatedFeedback,
        work_item: newWorkItem,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, 'Error converting feedback')
  }
}
