import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendDocRequestEmail(params: {
  to: string
  borrowerName: string
  brokerName: string
  orgName: string
  message: string | null
  loginUrl: string
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) throw new Error('RESEND_API_KEY not configured')

  const escaped = (params.message || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c))

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${params.orgName} <noreply@keyrealestatecapital.com>`,
      to: [params.to],
      reply_to: undefined,
      subject: `${params.brokerName} is requesting additional documents`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">${params.orgName}</h1>
            <p style="color: #666; font-size: 14px; margin-top: 4px;">Document Request</p>
          </div>

          <div style="background: #f8fafb; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px;">Hi ${params.borrowerName.split(' ')[0] || params.borrowerName},</h2>
            <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              ${params.brokerName} is requesting additional documents to move your loan application forward.
            </p>
            ${params.message ? `
              <div style="background: white; border-left: 3px solid #0d9488; border-radius: 4px; padding: 16px 20px; margin: 0 0 24px;">
                <p style="color: #1a1a1a; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-line;">${escaped}</p>
                <p style="color: #888; font-size: 12px; margin: 12px 0 0;">— ${params.brokerName}</p>
              </div>
            ` : `
              <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                Sign in to your borrower portal and upload the requested documents from the <strong>Documents</strong> tab.
              </p>
            `}

            <a href="${params.loginUrl}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              Sign In & Upload Documents
            </a>

            <p style="color: #666; font-size: 13px; line-height: 1.6; margin: 24px 0 0;">
              Or copy and paste this link into your browser:<br>
              <a href="${params.loginUrl}" style="color: #0d9488; word-break: break-all;">${params.loginUrl}</a>
            </p>
          </div>

          <p style="color: #999; font-size: 13px; text-align: center; margin: 0;">
            If you have any questions, reply to this email or contact your broker directly.
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

    const { borrower_id, message } = await req.json()
    if (!borrower_id) {
      return new Response(JSON.stringify({ error: 'Missing borrower_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: borrower } = await serviceClient
      .from('borrowers')
      .select('borrower_name, email, user_id')
      .eq('id', borrower_id)
      .maybeSingle()

    if (!borrower?.email) {
      return new Response(JSON.stringify({ error: 'Borrower has no email on file' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Resolve broker info from caller
    const { data: broker } = await serviceClient
      .from('user_accounts')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .maybeSingle()
    const brokerName = broker
      ? [broker.first_name, broker.last_name].filter(Boolean).join(' ') || broker.email || 'Your broker'
      : 'Your broker'

    // Resolve org name
    let orgName = 'Key Real Estate Capital'
    const { data: orgMember } = await serviceClient
      .from('organization_members')
      .select('organizations(name)')
      .eq('user_id', user.id)
      .maybeSingle()
    const org = orgMember?.organizations as unknown as { name?: string } | null
    if (org?.name) orgName = org.name

    const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || 'https://pcorigination.vercel.app'
    // Deep-link straight to the Documents tab; ProtectedRoute will detour
    // through /login if the borrower needs to authenticate, then bring them back.
    const loginUrl = `${origin}/application/documents`

    await sendDocRequestEmail({
      to: borrower.email,
      borrowerName: borrower.borrower_name,
      brokerName,
      orgName,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      loginUrl,
    })

    // Best-effort activity log
    await serviceClient.from('borrower_activity_log').insert({
      borrower_id,
      user_id: user.id,
      event_type: 'doc_request_sent',
      title: 'Document request sent',
      details: message ? `Broker requested additional documents: ${message.slice(0, 200)}` : 'Broker requested additional documents.',
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
