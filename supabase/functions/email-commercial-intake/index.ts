import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Emails a completed Commercial Intake PDF (generated client-side and passed as
// base64) to one or more recipients via Resend.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Require an authenticated caller.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonRes({ error: 'No authorization header' }, 401)
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return jsonRes({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const to: string[] = Array.isArray(body.to) ? body.to : (body.to ? [body.to] : [])
    const { subject, borrowerName, fileName, pdfBase64, message, orgName } = body as {
      subject?: string; borrowerName?: string; fileName?: string; pdfBase64?: string; message?: string; orgName?: string
    }

    const validTo = to.map((t) => String(t).trim()).filter((t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t))
    if (validTo.length === 0) return jsonRes({ error: 'A valid recipient email is required' }, 400)
    if (!pdfBase64) return jsonRes({ error: 'Missing PDF content' }, 400)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) return jsonRes({ error: 'Email is not configured (RESEND_API_KEY missing)' }, 500)

    const org = orgName || 'Key Real Estate Capital'
    const subj = subject || `Commercial Loan Request${borrowerName ? ` — ${borrowerName}` : ''}`
    const file = (fileName || 'commercial_intake.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_')

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${org} <noreply@keyrealestatecapital.com>`,
        to: validTo,
        subject: subj,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
            <h1 style="color:#1a1a1a;font-size:22px;margin:0 0 4px;">${org}</h1>
            <p style="color:#0d9488;font-size:14px;margin:0 0 20px;">Commercial Project Intake &amp; Loan Request</p>
            <p style="color:#333;font-size:15px;line-height:1.5;">${message ? String(message).replace(/</g, '&lt;') : `Attached is the commercial loan request${borrowerName ? ` for <strong>${borrowerName}</strong>` : ''}. Please review the attached PDF for full project, sponsor, and financing details.`}</p>
            <p style="color:#888;font-size:12px;margin-top:24px;">Sent via ${org}.</p>
          </div>`,
        attachments: [{ filename: file, content: pdfBase64 }],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return jsonRes({ error: `Email failed: ${res.status} ${text.slice(0, 300)}` }, 502)
    }

    return jsonRes({ ok: true, sentTo: validTo })
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
