/**
 * Knowledge Topics API
 *
 * GET /api/knowledge/topics - List topic clusters
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthClaims } from '@/lib/auth/get-auth-claims'
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

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const claims = await getAuthClaims()

    if (!claims) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's team
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', claims.subject)
      .single()

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const teamId = membership.team_id

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
