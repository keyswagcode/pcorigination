import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;

// Admin client with service role - isolated from main auth session
const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}) : null;

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
  if (!adminClient) {
    return { success: false, email: params.email, tempPassword: '', error: 'Admin access not configured. Contact support.' };
  }

  const tempPassword = `Temp${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 100)}!`;

  try {
    // Create auth user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: params.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'broker', broker_role: params.brokerRole, must_change_password: true },
    });

    if (createError) {
      return { success: false, email: params.email, tempPassword: '', error: `Create user failed: ${createError.message}` };
    }

    if (!newUser?.user) {
      return { success: false, email: params.email, tempPassword: '', error: 'No user returned from create' };
    }

    const userId = newUser.user.id;

    // Update user_accounts with broker details
    const { error: updateError } = await adminClient
      .from('user_accounts')
      .update({
        first_name: params.firstName,
        last_name: params.lastName,
        user_role: 'broker',
        broker_role: params.brokerRole,
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Update user_accounts failed:', updateError);
    }

    // Add to organization
    if (params.organizationId) {
      const { error: orgError } = await adminClient.from('organization_members').insert({
        user_id: userId,
        organization_id: params.organizationId,
        role: params.brokerRole,
        display_name: `${params.firstName} ${params.lastName}`,
        email: params.email,
        is_active: true,
      });
      if (orgError) {
        console.error('Org member insert failed:', orgError);
      }
    }

    // Send password reset email (best effort)
    try {
      await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email: params.email,
        options: {
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
    } catch (e) {
      console.error('Reset email failed:', e);
    }

    return {
      success: true,
      userId,
      email: params.email,
      tempPassword,
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
