import { redirect } from 'next/navigation';
import { getAuthClaims } from '@/lib/auth/get-auth-claims';
import { createClient } from '@/lib/supabase/server';
import { UserProfileForm } from '@/components/user/user-profile-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function ProfilePage() {
  // Check authentication (canonical claims)
  const claims = await getAuthClaims();

  if (!claims) {
    redirect('/login');
  }

  const supabase = await createClient();

  // Get user profile from public.users table
  const { data: userProfile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', claims.subject)
    .single();

  if (error) {
    console.error('Error fetching user profile:', error);
  }

  // Merge canonical claims with profile data. Timestamps come from the
  // users table since canonical claims do not carry created_at/updated_at.
  const user = {
    id: claims.subject,
    email: claims.email ?? '',
    name: userProfile?.name || null,
    avatar_url: userProfile?.avatar_url || null,
    created_at: userProfile?.created_at ?? null,
    updated_at: userProfile?.updated_at ?? null,
  };

  // Get user's team memberships
  const { data: teamMemberships } = await supabase
    .from('team_members')
    .select(`
      id,
      role,
      joined_at,
      teams:team_id (
        id,
        name
      )
    `)
    .eq('user_id', claims.subject)
    .order('joined_at', { ascending: false });

  return (
    <div className="container max-w-4xl py-10">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
          <p className="text-muted-foreground mt-2">
            Manage your personal information and account settings
          </p>
        </div>

        {/* Profile Form */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your profile details and manage your avatar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UserProfileForm user={user} />
          </CardContent>
        </Card>

        {/* Team Memberships */}
        <Card>
          <CardHeader>
            <CardTitle>Team Memberships</CardTitle>
            <CardDescription>
              Teams you&apos;re a part of and your role in each
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamMemberships && teamMemberships.length > 0 ? (
              <div className="space-y-4">
                {teamMemberships.map((membership) => {
                  // Handle Supabase join returning array or single object
                  const teamsData = membership.teams;
                  const teamInfo = Array.isArray(teamsData) ? teamsData[0] : teamsData;
                  return (
                    <div
                      key={membership.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{teamInfo?.name || 'Unknown Team'}</p>
                        <p className="text-sm text-muted-foreground">
                          Joined {new Date(membership.joined_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm capitalize px-3 py-1 bg-secondary rounded-full">
                          {membership.role}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                You&apos;re not a member of any teams yet
              </p>
            )}
          </CardContent>
        </Card>

        {/* Account Details */}
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
            <CardDescription>
              Read-only information about your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Email Address</p>
                <p className="text-sm">{user.email}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">User ID</p>
                <p className="text-sm font-mono text-xs">{user.id}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Account Created</p>
                <p className="text-sm">
                  {user.created_at
                    ? new Date(user.created_at).toLocaleDateString()
                    : 'Unknown'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
                <p className="text-sm">
                  {user.updated_at
                    ? new Date(user.updated_at).toLocaleDateString()
                    : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
