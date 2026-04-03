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
    const { data, error } = await supabase.functions.invoke('invite-team-member', {
      body: {
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        broker_role: params.brokerRole,
        organization_id: params.organizationId,
      },
    });

    if (error) {
      return { success: false, email: params.email, tempPassword: '', error: error.message };
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
