/**
 * Knowledge Topics API
 *
 * GET /api/knowledge/topics - List topic clusters
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, resolveCallerTeam } from '@/lib/auth/api-guard'
import { getTopics, getTopicDocuments } from '@/lib/ai/compression'

/**
 * GET /api/knowledge/topics
 *
 * List topic clusters for a team/workspace
 *
 * Query params:
 * - workspaceId: Optional workspace scope
 * - includeDocuments: Include linked documents (default: false)
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
    const includeDocuments = searchParams.get('includeDocuments') === 'true'

    // Get topics
    const topics = await getTopics(teamId, workspaceId)

    // Optionally include documents for each topic
    if (includeDocuments) {
      const topicsWithDocs = await Promise.all(
        topics.map(async (topic) => {
          const documents = await getTopicDocuments(topic.id)
          return { ...topic, documents }
        })
      )
      return NextResponse.json({ topics: topicsWithDocs })
    }

    return NextResponse.json({ topics })
  } catch (error) {
    console.error('[Knowledge Topics API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get topics' },
      { status: 500 }
    )
  }
}
