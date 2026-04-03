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
    // Check if user already exists in auth
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === params.email);

    let userId: string;

    if (existingUser) {
      // User already exists in auth — reuse their account
      userId = existingUser.id;

      // Reset their password and update metadata
      await adminClient.auth.admin.updateUser(userId, {
        password: tempPassword,
        user_metadata: { role: 'broker', broker_role: params.brokerRole, must_change_password: true },
      });

      // Send a password reset email so they get an actual email
      await adminClient.auth.resetPasswordForEmail(params.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } else {
      // Invite new user — this actually sends an email via Supabase Auth
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(params.email, {
        data: { role: 'broker', broker_role: params.brokerRole, must_change_password: true },
        redirectTo: `${window.location.origin}/login`,
      });

      if (inviteError) {
        return { success: false, email: params.email, tempPassword: '', error: `Invite failed: ${inviteError.message}` };
      }

      if (!inviteData?.user) {
        return { success: false, email: params.email, tempPassword: '', error: 'No user returned from invite' };
      }

      userId = inviteData.user.id;

      // Set the temp password so they can also log in directly
      await adminClient.auth.admin.updateUser(userId, {
        password: tempPassword,
      });
    }

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

    // Add to organization or reactivate existing membership
    if (params.organizationId) {
      const { data: existingMember } = await adminClient
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', params.organizationId)
        .maybeSingle();

      if (existingMember) {
        await adminClient.from('organization_members').update({
          role: params.brokerRole,
          display_name: `${params.firstName} ${params.lastName}`,
          email: params.email,
          is_active: true,
          invite_status: 'pending',
        }).eq('id', existingMember.id);
      } else {
        const { error: orgError } = await adminClient.from('organization_members').insert({
          user_id: userId,
          organization_id: params.organizationId,
          role: params.brokerRole,
          display_name: `${params.firstName} ${params.lastName}`,
          email: params.email,
          is_active: true,
          invite_status: 'pending',
        });
        if (orgError) {
          console.error('Org member insert failed:', orgError);
        }
      }
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
