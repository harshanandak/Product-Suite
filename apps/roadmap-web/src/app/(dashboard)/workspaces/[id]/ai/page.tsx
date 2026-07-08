import { getAuthClaims } from '@/lib/auth/get-auth-claims'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AIPageClient } from './_components/ai-page-client'

export default async function AIPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Check authentication (canonical claims)
  const claims = await getAuthClaims()

  if (!claims) {
    redirect('/login')
  }

  const supabase = await createClient()

  // Get workspace with phase
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id, name, team_id, phase')
    .eq('id', id)
    .single()

  if (error || !workspace) {
    notFound()
  }

  // Check if user has access to this workspace's team
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', workspace.team_id)
    .eq('user_id', claims.subject)
    .single()

  if (!teamMember) {
    redirect('/dashboard')
  }

  // Get team info
  const { data: team } = await supabase
    .from('teams')
    .select('name, subscription_plan')
    .eq('id', workspace.team_id)
    .single()

  return (
    <AIPageClient
      workspaceId={workspace.id}
      teamId={workspace.team_id}
      workspaceName={workspace.name}
      workspacePhase={workspace.phase || undefined}
      teamName={team?.name || 'Team'}
      userRole={teamMember.role}
    />
  )
}
