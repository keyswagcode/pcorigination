import { supabase } from '../lib/supabase';

interface InviteResult {
  success: boolean;
  userId?: string;
  email: string;
  tempPassword: string;
  error?: string;
}

export async function inviteTeamMember(params: {
  email: string;
  firstName: string;
  lastName: string;
  brokerRole: string;
  organizationId: string | null;
}): Promise<InviteResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, email: params.email, tempPassword: '', error: 'Not authenticated' };
    }

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        broker_role: params.brokerRole,
        organization_id: params.organizationId,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, email: params.email, tempPassword: '', error: data?.error || `Server error: ${res.status}` };
    }

    if (!data?.success) {
      return { success: false, email: params.email, tempPassword: '', error: data?.error || 'Invite failed' };
    }

    return {
      success: true,
      userId: data.user_id,
      email: params.email,
      tempPassword: data.temp_password,
    };
  } catch (err) {
    return {
      success: false,
      email: params.email,
      tempPassword: '',
      error: err instanceof Error ? err.message : 'Unknown error occurred',
    };
  }
}
