import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Escape everything interpolated into the email HTML — borrower_name comes
// from user input.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Test fixtures / obviously-fake addresses we must never email.
const TEST_EMAIL_RE = /deleteme|@example\.com|test/i

// Abandoned-application follow-up — invoked by the hourly cron, not a user.
// Emails each borrower who started an application 24-72h ago but never
// finished verification, exactly once (stamped via followup_sent_at).
// Unauthenticated like the other internal crons in this project: it takes no
// input and returns no PII, only counts; the worst an external caller can do
// is trigger follow-ups already owed to abandoned borrowers.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) return jsonRes({ error: 'Email is not configured (RESEND_API_KEY missing)' }, 500)

    // Safety window: created between 72h and 24h ago. The lower bound gives
    // borrowers a full day before we nudge; the upper bound means a broken
    // cron can never bulk-email the whole historical table when it recovers.
    const now = Date.now()
    const windowStart = new Date(now - 72 * 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(now - 24 * 60 * 60 * 1000).toISOString()

    // The two .or() filters AND together, giving IS DISTINCT FROM semantics:
    // a NULL plaid_report_status / borrower_status is exactly the abandoned
    // case, and a plain neq/not.in would silently drop NULLs.
    const { data: rows, error: selectError } = await serviceClient
      .from('borrowers')
      .select('id, borrower_name, email')
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .is('followup_sent_at', null)
      .not('email', 'is', null)
      .or('plaid_report_status.is.null,plaid_report_status.neq.ready')
      .or('borrower_status.is.null,borrower_status.not.in.("prequalified","submitted")')
    if (selectError) throw selectError

    type Candidate = { id: string; borrower_name: string | null; email: string }
    const candidates = (rows || []) as Candidate[]
    if (candidates.length === 0) {
      return jsonRes({ candidates: 0, emailed: 0, skippedClients: 0, errors: 0 })
    }

    // Exclude past/active clients: anyone with a pre-approval, serviced loan,
    // loan scenario, financial profile, or uploaded document is not "abandoned".
    const ids = candidates.map((c) => c.id)
    const clientIds = new Set<string>()
    for (const table of ['pre_approvals', 'serviced_loans', 'loan_scenarios', 'borrower_financial_profiles', 'uploaded_documents']) {
      const { data: refs, error: refError } = await serviceClient
        .from(table)
        .select('borrower_id')
        .in('borrower_id', ids)
      if (refError) throw refError
      for (const r of (refs || []) as Array<{ borrower_id: string }>) {
        if (r.borrower_id) clientIds.add(r.borrower_id)
      }
    }

    let emailed = 0, skippedClients = 0, errors = 0
    for (const borrower of candidates) {
      if (clientIds.has(borrower.id)) { skippedClients++; continue }
      if (!borrower.email || TEST_EMAIL_RE.test(borrower.email)) { skippedClients++; continue }

      const firstName = esc((borrower.borrower_name || '').trim().split(/\s+/)[0] || '')
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,'

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Key Real Estate Capital <noreply@keyrealestatecapital.com>',
            to: [borrower.email],
            subject: "You're one step away from your pre-approval",
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
                <h1 style="color:#1a1a1a;font-size:22px;margin:0 0 4px;">Key Real Estate Capital</h1>
                <p style="color:#0d9488;font-size:14px;margin:0 0 20px;">Your pre-approval is almost ready</p>
                <p style="color:#333;font-size:15px;line-height:1.5;">${greeting}</p>
                <p style="color:#333;font-size:15px;line-height:1.5;">You started your loan application with Key Real Estate Capital and you're just one step away from your pre-approval. Connect a bank account for instant verification, or upload your bank statements — it takes under 2 minutes.</p>
                <p style="margin:28px 0;">
                  <a href="https://pcorigination.vercel.app/application" style="background:#0d9488;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:6px;display:inline-block;">Finish my application</a>
                </p>
                <p style="color:#888;font-size:12px;margin-top:24px;">Sent by Key Real Estate Capital &middot; reply to this email with any questions</p>
              </div>`,
          }),
        })

        if (res.ok) {
          emailed++
        } else {
          errors++
        }
        // Idempotency: stamp followup_sent_at on success AND on 4xx (a
        // permanently-rejected send would otherwise retry-spam every hour).
        // Only network errors / 5xx leave it null for the next run to retry.
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          await serviceClient
            .from('borrowers')
            .update({ followup_sent_at: new Date().toISOString() })
            .eq('id', borrower.id)
        }
      } catch (_err) {
        // Network failure — leave followup_sent_at null so the next run retries.
        errors++
      }
    }

    return jsonRes({ candidates: candidates.length, emailed, skippedClients, errors })
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
