import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam, handleRouteError } from '@/lib/auth/api-guard'
import { NextResponse } from 'next/server'

/**
 * GET /api/timeline-items
 * List timeline items with optional filters
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get user's team
    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Parse filters
    const workItemId = searchParams.get('work_item_id')
    const workspaceId = searchParams.get('workspace_id')
    const timeline = searchParams.get('timeline')
    const status = searchParams.get('status')
    const phase = searchParams.get('phase')
    const assignedTo = searchParams.get('assigned_to')
    const isBlocked = searchParams.get('is_blocked')

    // Build query
    let query = supabase
      .from('timeline_items')
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        assigned_to_user:users!assigned_to(id, name, email)
      `)
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })

    // Apply filters
    if (workItemId) {
      query = query.eq('work_item_id', workItemId)
    }
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId)
    }
    if (timeline) {
      query = query.eq('timeline', timeline)
    }
    if (status) {
      query = query.eq('status', status)
    }
    if (phase) {
      query = query.eq('phase', phase)
    }
    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo)
    }
    if (isBlocked !== null) {
      query = query.eq('is_blocked', isBlocked === 'true')
    }

    const { data: timelineItems, error: fetchError } = await query

    if (fetchError) {
      throw fetchError
    }

    return NextResponse.json(timelineItems, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'GET /api/timeline-items')
  }
}

/**
 * POST /api/timeline-items
 * Create new timeline item
 */
export async function POST(request: Request) {
  try {
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

    const {
      work_item_id,
      workspace_id,
      timeline,
      difficulty,
      description,
      estimated_hours,
      category,
      integration_type,
      planned_start_date,
      planned_end_date,
      assigned_to,
      status,
      phase,
    } = body

    // Validate required fields
    if (!work_item_id || !timeline || !difficulty) {
      return NextResponse.json(
        { error: 'work_item_id, timeline, and difficulty are required' },
        { status: 400 }
      )
    }

    // Validate timeline
    if (!['MVP', 'SHORT', 'LONG'].includes(timeline)) {
      return NextResponse.json(
        { error: 'timeline must be MVP, SHORT, or LONG' },
        { status: 400 }
      )
    }

    // Validate difficulty
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return NextResponse.json(
        { error: 'difficulty must be easy, medium, or hard' },
        { status: 400 }
      )
    }

    // Validate phase if provided
    // Updated 2025-12-13: Migrated to 4-phase system
    const validPhases = ['design', 'build', 'refine', 'launch']
    if (phase && !validPhases.includes(phase)) {
      return NextResponse.json(
        { error: 'phase must be one of: design, build, refine, launch' },
        { status: 400 }
      )
    }

    // Verify work item exists and belongs to team
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, workspace_id, team_id')
      .eq('id', work_item_id)
      .eq('team_id', teamId)
      .single()

    if (workItemError || !workItem) {
      return NextResponse.json(
        { error: 'Work item not found' },
        { status: 404 }
      )
    }

    // Create timeline item
    const id = Date.now().toString()
    const timelineItem = {
      id,
      work_item_id,
      team_id: teamId,
      workspace_id: workspace_id || workItem.workspace_id,
      user_id: claims.subject,
      timeline,
      difficulty,
      description: description || null,
      estimated_hours: estimated_hours || null,
      category: category || null,
      integration_type: integration_type || null,
      planned_start_date: planned_start_date || null,
      planned_end_date: planned_end_date || null,
      assigned_to: assigned_to || null,
      status: status || 'not_started',
      phase: phase || 'design', // Updated 2025-12-13: Default to 'design' (was 'planning')
      progress_percent: 0,
      is_blocked: false,
      blockers: [],
    }

    const { data: newTimelineItem, error: createError } = await supabase
      .from('timeline_items')
      .insert(timelineItem)
      .select(`
        *,
        work_item:work_items!work_item_id(id, name, type),
        assigned_to_user:users!assigned_to(id, name, email)
      `)
      .single()

    if (createError) {
      throw createError
    }

    return NextResponse.json(newTimelineItem, { status: 201 })
  } catch (error) {
    return handleRouteError(error, 'POST /api/timeline-items')
  }
}
