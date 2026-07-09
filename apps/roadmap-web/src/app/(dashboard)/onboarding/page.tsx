import { getAuthClaims } from '@/lib/auth/get-auth-claims'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'

export default async function OnboardingPage() {
  // Check authentication (canonical claims)
  const claims = await getAuthClaims()

  if (!claims) {
    redirect('/login')
  }

  const supabase = await createClient()

  // Check if user already has teams
  const { data: teamMembers } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', claims.subject)
    .limit(1)

  // If user has teams, redirect to dashboard (which will redirect to workspace)
  if (teamMembers && teamMembers.length > 0) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <OnboardingFlow user={{ id: claims.subject, email: claims.email }} />
    </div>
  )
}
