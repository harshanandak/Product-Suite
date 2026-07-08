/**
 * BlockSuite Documents API
 * POST - Create new canvas document with rate limiting
 *
 * SECURITY:
 * - Rate limiting prevents resource exhaustion
 * - Team membership verification
 * - Input validation with Zod
 * - Audit logging for document creation
 */

import { createClient } from '@/lib/supabase/server'
import { requireAuth, handleRouteError } from '@/lib/auth/api-guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isValidId, getStoragePath } from '@/components/blocksuite/persistence-types'
import { rateLimiters, checkRateLimit, getRateLimitIdentifier, createRateLimitHeaders } from '@/lib/rate-limiter'

// Validation schema for document creation
const CreateDocumentSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  documentType: z.enum(['mindmap', 'document', 'canvas']),
  title: z.string().min(1).max(200).trim(),
})

/**
 * Audit log helper for security-relevant operations
 */
function auditLog(event: string, details: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      event,
      ...details,
      timestamp: new Date().toISOString(),
    })
  )
}

/**
 * POST /api/blocksuite/documents
 * Create a new canvas document with rate limiting
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // SECURITY: Rate limiting with Upstash Redis
    const rateLimitId = getRateLimitIdentifier(claims.subject)
    const rateLimitResult = await checkRateLimit(rateLimiters.blocksuiteDocuments, rateLimitId)

    if (!rateLimitResult.success) {
      auditLog('rate_limit_exceeded', {
        userId: claims.subject,
        endpoint: 'document_create',
        resetAt: rateLimitResult.reset,
      })
      const headers = createRateLimitHeaders(rateLimitResult)
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = CreateDocumentSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const { workspaceId, documentType, title } = validation.data

    // Validate workspaceId format
    if (!isValidId(workspaceId)) {
      return NextResponse.json(
        { error: 'Invalid workspace ID format' },
        { status: 400 }
      )
    }

    // Get workspace and verify team membership
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, team_id')
      .eq('id', workspaceId)
      .single()

    if (workspaceError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Verify user is a member of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', workspace.team_id)
      .eq('user_id', claims.subject)
      .single()

    if (!membership) {
      auditLog('unauthorized_document_create', {
        userId: claims.subject,
        workspaceId,
        teamId: workspace.team_id,
      })
      return NextResponse.json({ error: 'Not a team member' }, { status: 403 })
    }

    // Generate document ID using timestamp
    const documentId = Date.now().toString()
    const storagePath = getStoragePath(workspace.team_id, documentId)

    // Create the document record
    const { data: document, error: insertError } = await supabase
      .from('blocksuite_documents')
      .insert({
        id: documentId,
        team_id: workspace.team_id,
        workspace_id: workspaceId,
        storage_path: storagePath,
        storage_size_bytes: 0,
        document_type: documentType,
        title: title,
      })
      .select()
      .single()

    if (insertError) {
      auditLog('document_create_failed', {
        userId: claims.subject,
        workspaceId,
        error: insertError.message,
      })
      return NextResponse.json(
        { error: 'Failed to create document' },
        { status: 500 }
      )
    }

    auditLog('document_created', {
      userId: claims.subject,
      documentId,
      workspaceId,
      teamId: workspace.team_id,
      documentType,
    })

    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        documentType: document.document_type,
        workspaceId: document.workspace_id,
      },
    })
  } catch (error) {
    return handleRouteError(error, '[API] Document creation error')
  }
}

/**
 * GET /api/blocksuite/documents
 * List documents for a workspace
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check — provider-neutral canonical claims (see lib/auth/get-auth-claims)
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const claims = auth

    // Get workspaceId from query params
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId || !isValidId(workspaceId)) {
      return NextResponse.json(
        { error: 'Invalid or missing workspaceId' },
        { status: 400 }
      )
    }

    // Get workspace and verify team membership
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, team_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Verify user is a member of the team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', workspace.team_id)
      .eq('user_id', claims.subject)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Not a team member' }, { status: 403 })
    }

    // Get documents for the workspace
    const { data: documents, error } = await supabase
      .from('blocksuite_documents')
      .select('id, title, document_type, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('team_id', workspace.team_id)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch documents' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      documents: documents || [],
    })
  } catch (error) {
    return handleRouteError(error, '[API] Document list error')
  }
}
