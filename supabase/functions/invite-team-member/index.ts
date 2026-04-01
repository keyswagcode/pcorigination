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

    // Create the auth user
    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'broker', broker_role, must_change_password: true },
    })

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!newUser.user) {
      return new Response(JSON.stringify({ error: 'Failed to create user' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      .eq('id', newUser.user.id)

    // Add to organization if provided
    if (organization_id) {
      await serviceClient.from('organization_members').insert({
        user_id: newUser.user.id,
        organization_id,
        role: broker_role,
        display_name: `${first_name} ${last_name}`,
        email,
        is_active: true,
      })
    }

    // Send password reset email so they can set their own password
    await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${req.headers.get('origin') || Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '')}/reset-password`,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      user_id: newUser.user.id,
      email,
      temp_password: tempPassword,
      message: `Invite sent to ${email}. They can log in with the temporary password or use the reset link in their email.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
