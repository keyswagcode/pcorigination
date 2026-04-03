import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is authenticated
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user: caller }, error: authError } = await authClient.auth.getUser()
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, first_name, last_name, broker_role, organization_id } = await req.json()

    if (!email || !first_name || !last_name || !broker_role) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify caller is owner or admin
    const { data: callerAccount } = await serviceClient
      .from('user_accounts')
      .select('broker_role, user_role')
      .eq('id', caller.id)
      .single()

    if (!callerAccount || !['owner', 'admin'].includes(callerAccount.broker_role || '')) {
      return new Response(JSON.stringify({ error: 'Only owners and admins can invite team members' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate a temporary password
    const tempPassword = `Temp${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 100)}!`

    const redirectUrl = req.headers.get('origin') || 'https://loanflowtech.com'

    // Check if user already exists
    const { data: existingUsers } = await serviceClient.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find((u: { email?: string }) => u.email === email)

    let userId: string

    if (existingUser) {
      userId = existingUser.id

      await serviceClient.auth.admin.updateUser(userId, {
        password: tempPassword,
        user_metadata: { role: 'broker', broker_role, must_change_password: true },
      })

      await serviceClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectUrl}/reset-password`,
      })
    } else {
      // Invite new user — sends actual email
      const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { role: 'broker', broker_role, must_change_password: true },
        redirectTo: `${redirectUrl}/login`,
      })

      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!inviteData.user) {
        return new Response(JSON.stringify({ error: 'Failed to create user' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      userId = inviteData.user.id

      // Set temp password so they can also log in directly
      await serviceClient.auth.admin.updateUser(userId, { password: tempPassword })
    }

    // Update user_accounts with broker details
    await serviceClient
      .from('user_accounts')
      .update({
        first_name,
        last_name,
        user_role: 'broker',
        broker_role,
      })
      .eq('id', userId)

    // Add to organization or reactivate
    if (organization_id) {
      const { data: existingMember } = await serviceClient
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organization_id)
        .maybeSingle()

      if (existingMember) {
        await serviceClient.from('organization_members').update({
          role: broker_role,
          display_name: `${first_name} ${last_name}`,
          email,
          is_active: true,
          invite_status: 'pending',
        }).eq('id', existingMember.id)
      } else {
        await serviceClient.from('organization_members').insert({
          user_id: userId,
          organization_id,
          role: broker_role,
          display_name: `${first_name} ${last_name}`,
          email,
          is_active: true,
          invite_status: 'pending',
        })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email,
      temp_password: tempPassword,
      message: `Invite sent to ${email}. They will receive an email to set up their account.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
