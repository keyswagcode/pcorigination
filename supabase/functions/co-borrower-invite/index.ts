import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendInviteEmail(params: {
  to: string
  coBorrowerName: string
  inviterName: string
  inviteUrl: string
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
      subject: `${params.inviterName} invited you to join a loan application`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">Key Real Estate Capital</h1>
            <p style="color: #666; font-size: 14px; margin-top: 4px;">Loan Application</p>
          </div>

          <div style="background: #f8fafb; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px;">Hi ${params.coBorrowerName},</h2>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              <strong>${params.inviterName}</strong> has added you as a co-borrower on their loan application with Key Real Estate Capital.
            </p>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
              To move the application forward, we need a few details from you. Click the button below to securely fill out your information — it takes about 2 minutes.
            </p>

            <a href="${params.inviteUrl}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              Complete Your Information
            </a>

            <p style="color: #666; font-size: 13px; line-height: 1.6; margin: 24px 0 0;">
              Or copy and paste this link into your browser:<br>
              <a href="${params.inviteUrl}" style="color: #0d9488; word-break: break-all;">${params.inviteUrl}</a>
            </p>
          </div>

          <p style="color: #999; font-size: 13px; text-align: center; margin: 0;">
            Your information is encrypted and used only for this loan application.<br>
            If you didn't expect this invite, you can safely ignore this email.
          </p>
        </div>
      `,
    }),
  })
  if (!res.ok) throw new Error(`Resend API: ${res.status} ${await res.text()}`)
  return res.json()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const { action } = body

    // SEND — borrower invites a co-borrower (authenticated)
    if (action === 'send') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'No authorization header' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await serviceClient.auth.getUser(token)
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { co_borrower_name, co_borrower_email, co_borrower_id } = body
      if (!co_borrower_name || !co_borrower_email) {
        return new Response(JSON.stringify({ error: 'Missing co-borrower name or email' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: primary, error: primaryError } = await serviceClient
        .from('borrowers')
        .select('id, borrower_name')
        .eq('user_id', user.id)
        .maybeSingle()
      if (primaryError) throw primaryError
      if (!primary) throw new Error('Primary borrower not found')

      const inviteToken = crypto.randomUUID()

      // If co_borrower_id provided, this is a resend — rotate token and reset status.
      // Otherwise, insert a new row.
      if (co_borrower_id) {
        const { error: updateError } = await serviceClient
          .from('co_borrowers')
          .update({
            invite_token: inviteToken,
            status: 'invited',
            email: co_borrower_email,
            borrower_name: co_borrower_name,
          })
          .eq('id', co_borrower_id)
          .eq('borrower_id', primary.id)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await serviceClient
          .from('co_borrowers')
          .insert({
            borrower_id: primary.id,
            borrower_name: co_borrower_name,
            email: co_borrower_email,
            status: 'invited',
            invite_token: inviteToken,
            filled_by_self: true,
          })
        if (insertError) throw insertError
      }

      const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || ''
      const inviteUrl = `${origin}/co-borrower-invite/${inviteToken}`

      await sendInviteEmail({
        to: co_borrower_email,
        coBorrowerName: co_borrower_name,
        inviterName: primary.borrower_name || 'Your co-borrower',
        inviteUrl,
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // GET — landing page loads invite details by token (public)
    if (action === 'get') {
      const { invite_token } = body
      if (!invite_token) {
        return new Response(JSON.stringify({ error: 'Missing token' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: cb } = await serviceClient
        .from('co_borrowers')
        .select('id, borrower_id, borrower_name, email, status, borrowers!inner(borrower_name)')
        .eq('invite_token', invite_token)
        .maybeSingle()

      if (!cb) {
        return new Response(JSON.stringify({ error: 'Invite not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        co_borrower_name: cb.borrower_name,
        co_borrower_email: cb.email,
        inviter_name: (cb.borrowers as unknown as { borrower_name: string }).borrower_name,
        status: cb.status,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // SUBMIT — co-borrower completes their profile via the invite (public)
    if (action === 'submit') {
      const {
        invite_token, borrower_name, email, phone, date_of_birth, ssn,
        credit_score, address_street, address_city, address_state, address_zip,
      } = body

      if (!invite_token) {
        return new Response(JSON.stringify({ error: 'Missing token' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const ssnDigits = String(ssn || '').replace(/\D/g, '')

      const { error: updateError } = await serviceClient
        .from('co_borrowers')
        .update({
          borrower_name: borrower_name || null,
          email: email || null,
          phone: (phone || '').replace(/\D/g, '') || null,
          date_of_birth: date_of_birth || null,
          ssn_last4: ssnDigits.slice(-4) || null,
          ssn_encrypted: ssnDigits || null,
          credit_score: credit_score ? parseInt(credit_score, 10) : null,
          address_street: address_street || null,
          address_city: address_city || null,
          address_state: address_state || null,
          address_zip: address_zip || null,
          status: 'completed',
        })
        .eq('invite_token', invite_token)

      if (updateError) throw updateError

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
