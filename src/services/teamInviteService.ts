import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;

// Admin client with service role - only used for team invites
const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey) : null;

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
    return { success: false, email: params.email, tempPassword: '', error: 'Admin access not configured' };
  }

  // Generate temp password
  const tempPassword = `Temp${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 100)}!`;

  // Create auth user
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email: params.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role: 'broker', broker_role: params.brokerRole, must_change_password: true },
  });

  if (createError) {
    return { success: false, email: params.email, tempPassword: '', error: createError.message };
  }

  if (!newUser.user) {
    return { success: false, email: params.email, tempPassword: '', error: 'Failed to create user' };
  }

  // Update user_accounts
  await adminClient
    .from('user_accounts')
    .update({
      first_name: params.firstName,
      last_name: params.lastName,
      user_role: 'broker',
      broker_role: params.brokerRole,
    })
    .eq('id', newUser.user.id);

  // Add to organization
  if (params.organizationId) {
    await adminClient.from('organization_members').insert({
      user_id: newUser.user.id,
      organization_id: params.organizationId,
      role: params.brokerRole,
      display_name: `${params.firstName} ${params.lastName}`,
      email: params.email,
      is_active: true,
    });
  }

  // Send password reset email
  await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email: params.email,
    options: {
      redirectTo: `${window.location.origin}/reset-password`,
    },
  });

  return {
    success: true,
    userId: newUser.user.id,
    email: params.email,
    tempPassword,
  };
}
