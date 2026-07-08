/**
 * Knowledge Graph API
 *
 * GET /api/knowledge/graph - Get knowledge graph for visualization
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam } from '@/lib/auth/api-guard'
import { getKnowledgeGraph } from '@/lib/ai/compression'

/**
 * GET /api/knowledge/graph
 *
 * Get the knowledge graph for a team/workspace
 *
 * Query params:
 * - workspaceId: Optional workspace scope
 * - limit: Max concepts (default: 50, max: 100)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth guard (see lib/auth/api-guard)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    const team = await resolveCallerTeam(supabase, claims.subject)
    if (team instanceof NextResponse) return team
    const { teamId } = team

    // Parse query params
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId') || undefined
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    // Get knowledge graph
    const graph = await getKnowledgeGraph(teamId, workspaceId, limit)

    return NextResponse.json({ graph })
  } catch (error) {
    console.error('[Knowledge Graph API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get knowledge graph' },
      { status: 500 }
    )
  }
}
