import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Emails the borrower's AE (owning broker) when bank statements land in the
// manual-review queue, so nothing sits unnoticed. Called fire-and-forget from
// the borrower portal after an upload routes to review.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Require the calling borrower's own session.
    const authHeader = req.headers.get('Authorization') || ''
    const { data: { user } } = await serviceClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { borrower_id, file_names, auto_extracted } = await req.json().catch(() => ({}))
    if (!borrower_id) {
      return new Response(JSON.stringify({ error: 'borrower_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Caller must own this borrower record (borrowers notify about themselves).
    const { data: borrower } = await serviceClient
      .from('borrowers')
      .select('id, borrower_name, email, broker_id, user_id')
      .eq('id', borrower_id)
      .maybeSingle()
    if (!borrower || borrower.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!borrower.broker_id) {
      return new Response(JSON.stringify({ ok: false, reason: 'no AE assigned' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: ae } = await serviceClient
      .from('user_accounts')
      .select('email, first_name')
      .eq('id', borrower.broker_id)
      .maybeSingle()
    if (!ae?.email) {
      return new Response(JSON.stringify({ ok: false, reason: 'AE has no email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, reason: 'email not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Failure alerts share a 1-hour dedup window with process-documents'
    // server-side alert (same activity-log event), so a statement that both
    // paths flag doesn't email the AE twice.
    if (!auto_extracted) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: recentAlert } = await serviceClient
        .from('borrower_activity_log')
        .select('id')
        .eq('borrower_id', borrower.id)
        .eq('event_type', 'manual_review_alert')
        .gte('created_at', oneHourAgo)
        .limit(1)
        .maybeSingle()
      if (recentAlert) {
        return new Response(JSON.stringify({ ok: true, deduped: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const name = esc(borrower.borrower_name || 'A borrower')
    const files = Array.isArray(file_names) ? file_names.slice(0, 10).map((f: unknown) => esc(String(f))).join(', ') : ''
    const detail = auto_extracted
      ? 'Statements were uploaded and liquidity was auto-extracted — review and finalize the pre-approval.'
      : 'Statements were uploaded but could not be read automatically — a manual review is needed to set liquidity and pre-approve.'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Key Real Estate Capital <noreply@keyrealestatecapital.com>',
        to: [ae.email],
        subject: `Review needed: ${borrower.borrower_name || 'borrower'} uploaded bank statements`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
            <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 4px;">Manual review needed</h1>
            <p style="color:#0d9488;font-size:13px;margin:0 0 20px;">Loan Center · bank statement review queue</p>
            <p style="color:#333;font-size:15px;line-height:1.6;"><strong>${name}</strong>${borrower.email ? ` (${esc(borrower.email)})` : ''} uploaded bank statements. ${detail}</p>
            ${files ? `<p style="color:#666;font-size:13px;">Files: ${files}</p>` : ''}
            <a href="https://pcorigination.vercel.app/internal/my-borrowers/${borrower.id}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open borrower file</a>
            <p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically when statements enter the review queue.</p>
          </div>`,
      }),
    })

    if (res.ok && !auto_extracted) {
      await serviceClient.from('borrower_activity_log').insert({
        borrower_id: borrower.id,
        event_type: 'manual_review_alert',
        title: 'AE alerted: statements need manual read',
        details: `Statements could not be read automatically; emailed ${ae.email}`,
      })
    }

    return new Response(JSON.stringify({ ok: res.ok }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message.slice(0, 120) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
