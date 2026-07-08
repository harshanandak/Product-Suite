import { getAuthClaims } from '@/lib/auth/get-auth-claims'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Check authentication (canonical claims)
  const claims = await getAuthClaims()

  if (!claims) {
    redirect('/login')
  }

  const supabase = await createClient()

  // Fetch user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', claims.subject)
    .single()

  // Fetch user's team membership to get team ID
  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', claims.subject)
    .single()

  if (!membership) {
    // Handle case where user has no team (shouldn't happen in normal flow)
    return <>{children}</>
  }

  // Fetch workspaces for the sidebar
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, team_id')
    .eq('team_id', membership.team_id)
    .order('name')

  // Determine default workspace (first one)
  const defaultWorkspace = workspaces?.[0]

  // Get sidebar state from cookies
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        workspaceId={defaultWorkspace?.id || ''}
        workspaceName={defaultWorkspace?.name || 'Workspace'}
        workspaces={workspaces || []}
        teamId={membership.team_id}
        userEmail={claims.email ?? ''}
        userName={userProfile?.name || ''}
      />
      <SidebarInset>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
