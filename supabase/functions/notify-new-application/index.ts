import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendNewBorrowerEmail(params: {
  to: string[]
  borrowerName: string
  borrowerEmail: string
  borrowerPhone: string | null
  brokerName: string
  orgName: string
  appUrl: string
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.warn('RESEND_API_KEY not configured; skipping email')
    return
  }
  if (params.to.length === 0) return

  const dashboardLink = `${params.appUrl}/internal/dashboard`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${params.orgName} <noreply@keyrealestatecapital.com>`,
      to: params.to,
      subject: `New application: ${params.borrowerName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">${params.orgName}</h1>
            <p style="color: #666; font-size: 14px; margin-top: 4px;">New Application Received</p>
          </div>

          <div style="background: #f8fafb; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px;">A new borrower just signed up</h2>

            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Borrower</p>
              <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a; font-weight: 600;">${params.borrowerName}</p>
              <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Email</p>
              <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a;">${params.borrowerEmail}</p>
              ${params.borrowerPhone ? `<p style="margin: 0 0 8px; font-size: 14px; color: #666;">Phone</p><p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a;">${params.borrowerPhone}</p>` : ''}
              <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Assigned to</p>
              <p style="margin: 0; font-size: 16px; color: #1a1a1a;">${params.brokerName}</p>
            </div>

            <a href="${dashboardLink}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              View in Dashboard
            </a>
          </div>

          <p style="color: #999; font-size: 13px; text-align: center; margin: 0;">
            You're receiving this because you're set to receive new application alerts in this organization.
          </p>
        </div>
      `,
    }),
  })
  if (!res.ok) {
    console.error('Resend API failed:', res.status, await res.text())
  }
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

    const body = await req.json()
    const { borrower_name, borrower_email, borrower_phone, broker_id } = body
    if (!borrower_name || !borrower_email || !broker_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: broker } = await serviceClient
      .from('user_accounts')
      .select('email, first_name, last_name')
      .eq('id', broker_id)
      .maybeSingle()

    const { data: brokerOrgMember } = await serviceClient
      .from('organization_members')
      .select('organization_id, organizations(name, zapier_webhook_url)')
      .eq('user_id', broker_id)
      .maybeSingle()

    const org = brokerOrgMember?.organizations as { name?: string; zapier_webhook_url?: string | null } | null
    const orgName = org?.name || 'Key Real Estate Capital'

    // Build recipient list: broker + org owner + anyone with notify_new_apps=true
    const recipientEmails = new Set<string>()
    if (broker?.email) recipientEmails.add(broker.email)

    if (brokerOrgMember?.organization_id) {
      const { data: orgRecipients } = await serviceClient
        .from('organization_members')
        .select('email, user_id, role, notify_new_apps')
        .eq('organization_id', brokerOrgMember.organization_id)
        .eq('is_active', true)

      for (const m of orgRecipients || []) {
        if (!m.email) continue
        if (m.role === 'owner' || m.notify_new_apps) {
          recipientEmails.add(m.email)
        }
      }
    }

    const brokerName = broker
      ? [broker.first_name, broker.last_name].filter(Boolean).join(' ') || 'Broker'
      : 'Broker'

    const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || 'https://pcorigination.vercel.app'

    // Send the email
    await sendNewBorrowerEmail({
      to: Array.from(recipientEmails),
      borrowerName: borrower_name,
      borrowerEmail: borrower_email,
      borrowerPhone: borrower_phone || null,
      brokerName,
      orgName,
      appUrl: origin,
    })

    // Insert in-app notifications
    for (const email of recipientEmails) {
      const { data: recipientUser } = await serviceClient
        .from('user_accounts').select('id').eq('email', email).maybeSingle()
      if (recipientUser) {
        await serviceClient.from('notifications').insert({
          user_id: recipientUser.id,
          event_type: 'new_borrower',
          title: 'New Application Received',
          message: `${borrower_name} (${borrower_email}) has submitted a new application.`,
          priority: 'high',
          channel: 'in_app',
          data: {
            borrower_name,
            borrower_email,
            broker_id,
          },
        })
      }
    }

    // Fire Zapier webhook (best-effort)
    if (org?.zapier_webhook_url) {
      fetch(org.zapier_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'new_borrower',
          timestamp: new Date().toISOString(),
          borrower: { name: borrower_name, email: borrower_email, phone: borrower_phone || null },
          broker: { name: brokerName, email: broker?.email },
          alert_recipients: Array.from(recipientEmails),
          organization: orgName,
        }),
      }).catch(() => {})
    }

    return new Response(JSON.stringify({
      ok: true,
      recipients: Array.from(recipientEmails).length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('notify-new-application error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
