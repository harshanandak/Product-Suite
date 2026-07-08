import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, handleRouteError } from '@/lib/auth/api-guard';

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    // Auth guard (see lib/auth/api-guard)
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const claims = auth;

    const { data: teamMemberships, error } = await supabase
      .from('team_members')
      .select(`
        id,
        role,
        joined_at,
        teams:team_id (
          id,
          name,
          plan
        )
      `)
      .eq('user_id', claims.subject)
      .order('joined_at', { ascending: false });

    if (error) {
      console.error('Error fetching team memberships:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ teams: teamMemberships || [] });
  } catch (error) {
    return handleRouteError(error, 'Error in GET /api/user/teams');
  }
}
