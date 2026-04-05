import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendInviteEmail(params: {
  to: string
  firstName: string
  inviterName: string
  tempPassword: string
  loginUrl: string
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) throw new Error('RESEND_API_KEY not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Key Real Estate Capital <noreply@keyrealestatecapital.com>',
      to: [params.to],
      subject: `You've been invited to Key Real Estate Capital's Loan Platform`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">Key Real Estate Capital</h1>
            <p style="color: #666; font-size: 14px; margin-top: 4px;">Loan Platform</p>
          </div>

          <div style="background: #f8fafb; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px;">Welcome, ${params.firstName}!</h2>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              ${params.inviterName} has invited you to join the team on Key Real Estate Capital's loan origination platform.
            </p>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
              Use the credentials below to sign in and get started:
            </p>

            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Email</p>
              <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a; font-weight: 600;">${params.to}</p>
              <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Temporary Password</p>
              <p style="margin: 0; font-size: 16px; color: #1a1a1a; font-weight: 600; font-family: monospace; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; display: inline-block;">${params.tempPassword}</p>
            </div>

            <a href="${params.loginUrl}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              Sign In to Platform
            </a>
          </div>

          <p style="color: #999; font-size: 13px; text-align: center; margin: 0;">
            You'll be prompted to change your password on first login.<br>
            If you didn't expect this invite, you can safely ignore this email.
          </p>
        </div>
      `,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error: ${res.status} — ${body}`)
  }

  return await res.json()
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
      .select('broker_role, user_role, first_name, last_name')
      .eq('id', caller.id)
      .single()

    if (!callerAccount || !['owner', 'admin'].includes(callerAccount.broker_role || '')) {
      return new Response(JSON.stringify({ error: 'Only owners and admins can invite team members' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prevent inviting yourself
    if (caller.email === email) {
      return new Response(JSON.stringify({ error: 'You cannot invite yourself' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const inviterName = [callerAccount.first_name, callerAccount.last_name].filter(Boolean).join(' ') || 'Your team'

    // Generate a temporary password
    const tempPassword = `Temp${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 100)}!`

    const loginUrl = (req.headers.get('origin') || 'https://loanflowtech.com') + '/login'

    // Check if user already exists
    const { data: existingUsers, error: listError } = await serviceClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (listError) {
      return new Response(JSON.stringify({ error: `Failed to check existing users: ${listError.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const existingUser = existingUsers?.users?.find((u: { email?: string }) => u.email === email)

    let userId: string

    if (existingUser) {
      userId = existingUser.id

      // Reset their password and update metadata
      const { error: updateUserError } = await serviceClient.auth.admin.updateUserById(userId, {
        password: tempPassword,
        user_metadata: { role: 'broker', broker_role, must_change_password: true },
      })

      if (updateUserError) {
        return new Response(JSON.stringify({ error: `Failed to update user: ${updateUserError.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else {
      // Create new user directly (no Supabase invite email)
      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: 'broker', broker_role, must_change_password: true },
      })

      if (createError) {
        return new Response(JSON.stringify({ error: `Failed to create user: ${createError.message}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!newUser.user) {
        return new Response(JSON.stringify({ error: 'Failed to create user' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      userId = newUser.user.id
    }

    // Update user_accounts with broker details
    const { error: updateError } = await serviceClient
      .from('user_accounts')
      .update({
        first_name,
        last_name,
        user_role: 'broker',
        broker_role,
      })
      .eq('id', userId)

    if (updateError) {
      console.error('Failed to update user_accounts:', updateError)
      return new Response(JSON.stringify({ error: `Failed to update user account: ${updateError.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Add to organization or reactivate
    if (organization_id) {
      const { data: existingMember } = await serviceClient
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organization_id)
        .maybeSingle()

      if (existingMember) {
        const { error: orgUpdateError } = await serviceClient.from('organization_members').update({
          role: broker_role,
          display_name: `${first_name} ${last_name}`,
          email,
          is_active: true,
          invite_status: 'pending',
        }).eq('id', existingMember.id)

        if (orgUpdateError) {
          console.error('Failed to update organization_members:', orgUpdateError)
          return new Response(JSON.stringify({ error: `Failed to update team membership: ${orgUpdateError.message}` }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      } else {
        const { error: orgInsertError } = await serviceClient.from('organization_members').insert({
          user_id: userId,
          organization_id,
          role: broker_role,
          display_name: `${first_name} ${last_name}`,
          email,
          is_active: true,
          invite_status: 'pending',
        })

        if (orgInsertError) {
          console.error('Failed to insert organization_members:', orgInsertError)
          return new Response(JSON.stringify({ error: `Failed to add team member: ${orgInsertError.message}` }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    // Send branded invite email via Resend
    try {
      await sendInviteEmail({
        to: email,
        firstName: first_name,
        inviterName,
        tempPassword,
        loginUrl,
      })
    } catch (emailError) {
      console.error('Failed to send invite email:', emailError)
      // User was created successfully, just email failed — don't fail the whole request
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
    console.error('Invite error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
