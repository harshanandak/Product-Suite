/**
 * Plan Cancel API Endpoint
 *
 * Cancels an executing multi-step task plan.
 * Sets the cancel signal to stop execution after the current step.
 *
 * POST /api/ai/agent/plan/cancel
 *
 * Request body:
 * {
 *   planId: string
 *   threadId: string
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   message: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleRouteError, requireAuth } from '@/lib/auth/api-guard'
import { activePlanSignals } from '../approve/route'
import type { TaskPlan } from '@/lib/ai/task-planner'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { planId, threadId } = body as {
      planId: string
      threadId: string
    }

    if (!planId || !threadId) {
      return Response.json(
        { error: 'Missing required fields: planId, threadId' },
        { status: 400 }
      )
    }

    // Prevent prototype pollution by validating planId
    const dangerousKeys = ['__proto__', 'constructor', 'prototype']
    if (dangerousKeys.includes(planId)) {
      return Response.json(
        { error: 'Invalid planId' },
        { status: 400 }
      )
    }

    // Auth guard (see lib/auth/api-guard)
    const supabase = await createClient()
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    // Get the cancel signal for this plan
    const cancelSignal = activePlanSignals.get(planId)

    if (cancelSignal) {
      // Set the cancelled flag to stop execution
      cancelSignal.cancelled = true
      activePlanSignals.delete(planId)

      // Update plan status in thread metadata
      const { data: thread } = await supabase
        .from('chat_threads')
        .select('metadata')
        .eq('id', threadId)
        .single()

      if (thread) {
        const metadata = thread.metadata as Record<string, unknown> | null
        const pendingPlans = (metadata?.pendingPlans || {}) as Record<string, TaskPlan>

        // Safe property access to prevent prototype pollution
        if (Object.hasOwn(pendingPlans, planId)) {
          const plan = pendingPlans[planId]
          plan.status = 'cancelled'
          const updatedPlans = { ...pendingPlans, [planId]: plan }

          await supabase
            .from('chat_threads')
            .update({
              metadata: { ...metadata, pendingPlans: updatedPlans },
            })
            .eq('id', threadId)
        }
      }

      return Response.json({
        success: true,
        message: 'Plan execution cancelled. Current step will complete before stopping.',
      })
    }

    // Plan not currently executing
    return Response.json({
      success: false,
      message: 'Plan is not currently executing or has already completed.',
    })
  } catch (error) {
    return handleRouteError(error, '[Plan Cancel API] Error')
  }
}
