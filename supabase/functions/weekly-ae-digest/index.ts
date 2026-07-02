import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Escape everything interpolated into the email HTML — borrower names and
// emails come from user input.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Test fixtures / obviously-fake addresses we must never email.
const TEST_EMAIL_RE = /deleteme|@example\.com|test/i

const APP_URL = 'https://pcorigination.vercel.app'

type Borrower = {
  id: string
  borrower_name: string | null
  email: string | null
  broker_id: string | null
  borrower_status: string | null
  lifecycle_stage: string | null
  created_at: string
  updated_at: string | null
}

// PostgREST caps responses at 1000 rows — page through so a growing
// borrowers table never silently truncates the digest.
async function fetchAll<T>(
  // deno-lint-ignore no-explicit-any
  client: any,
  table: string,
  columns: string,
): Promise<T[]> {
  const pageSize = 1000
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(columns).range(from, from + pageSize - 1)
    if (error) throw error
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

function borrowerList(items: Borrower[]): string {
  return items
    .map((b) => {
      const name = esc((b.borrower_name || '').trim() || 'Unnamed borrower')
      const email = b.email ? ` <span style="color:#888;">&middot; ${esc(b.email)}</span>` : ''
      return `<li style="margin:0 0 8px;color:#333;font-size:14px;line-height:1.5;">
        <a href="${APP_URL}/internal/my-borrowers/${b.id}" style="color:#0d9488;text-decoration:none;font-weight:600;">${name}</a>${email}
      </li>`
    })
    .join('')
}

function section(title: string, items: Borrower[]): string {
  if (items.length === 0) return ''
  return `
    <h2 style="color:#1a1a1a;font-size:15px;margin:24px 0 8px;border-bottom:2px solid #0d9488;padding-bottom:4px;">${title} <span style="color:#0d9488;">(${items.length})</span></h2>
    <ul style="margin:0;padding-left:18px;">${borrowerList(items)}</ul>`
}

// Weekly AE digest — invoked by the Monday cron, not a user. Emails each
// active AE (broker/admin) a summary of their borrower book: new sign-ups,
// borrowers awaiting review, and pre-approved borrowers with no loan yet.
// Unauthenticated like the other internal crons in this project: it takes no
// input and returns no PII, only counts; the worst an external caller can do
// is send AEs an extra copy of their own digest.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) return jsonRes({ error: 'Email is not configured (RESEND_API_KEY missing)' }, 500)

    // Active AEs: brokers and admins with a real email address.
    const { data: aeRows, error: aeError } = await serviceClient
      .from('user_accounts')
      .select('id, email, first_name, last_name')
      .in('user_role', ['broker', 'admin'])
      .not('email', 'is', null)
    if (aeError) throw aeError

    type Ae = { id: string; email: string; first_name: string | null; last_name: string | null }
    const aes = ((aeRows || []) as Ae[]).filter((a) => a.email && !TEST_EMAIL_RE.test(a.email))

    if (aes.length === 0) return jsonRes({ aes: 0, emailed: 0, skipped: 0 })

    // All borrowers, grouped by broker_id in JS.
    const borrowers = await fetchAll<Borrower>(
      serviceClient,
      'borrowers',
      'id, borrower_name, email, broker_id, borrower_status, lifecycle_stage, created_at, updated_at',
    )
    const byBroker = new Map<string, Borrower[]>()
    for (const b of borrowers) {
      if (!b.broker_id) continue
      const list = byBroker.get(b.broker_id) || []
      list.push(b)
      byBroker.set(b.broker_id, list)
    }

    // Pre-approvals: borrower_id -> newest pre_approval created_at.
    const preApprovals = await fetchAll<{ borrower_id: string | null; created_at: string }>(
      serviceClient,
      'pre_approvals',
      'borrower_id, created_at',
    )
    const newestPreApproval = new Map<string, string>()
    for (const p of preApprovals) {
      if (!p.borrower_id) continue
      const prev = newestPreApproval.get(p.borrower_id)
      if (!prev || p.created_at > prev) newestPreApproval.set(p.borrower_id, p.created_at)
    }

    // Loan scenarios: which borrowers have at least one.
    const scenarios = await fetchAll<{ borrower_id: string | null; status: string | null; created_at: string }>(
      serviceClient,
      'loan_scenarios',
      'borrower_id, status, created_at',
    )
    const hasLoan = new Set<string>()
    for (const s of scenarios) {
      if (s.borrower_id) hasLoan.add(s.borrower_id)
    }

    const now = Date.now()
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()

    let emailed = 0, skipped = 0, errors = 0
    for (const ae of aes) {
      const book = byBroker.get(ae.id) || []

      // (a) New borrowers created in the last 7 days.
      const fresh = book.filter((b) => b.created_at >= sevenDaysAgo)

      // (b) Awaiting review: submitted but not yet pre-approved.
      const awaiting = book.filter(
        (b) => b.borrower_status === 'submitted' && b.lifecycle_stage !== 'pre_approved',
      )

      // (c) Pre-approved but idle: has a pre-approval, no loan scenario, and
      // the newest pre-approval is older than 3 days — stale hot leads.
      const idle = book.filter((b) => {
        const newest = newestPreApproval.get(b.id)
        return !!newest && !hasLoan.has(b.id) && newest < threeDaysAgo
      })

      // Nothing to report — no email noise.
      if (fresh.length === 0 && awaiting.length === 0 && idle.length === 0) {
        skipped++
        continue
      }

      // (d) Totals.
      const totalBorrowers = book.length
      const totalWithLoans = book.filter((b) => hasLoan.has(b.id)).length

      const firstName = esc((ae.first_name || '').trim())
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
      const awaitingAction = awaiting.length + idle.length

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Key Real Estate Capital <noreply@keyrealestatecapital.com>',
            to: [ae.email],
            subject: `Your weekly Loan Center digest — ${fresh.length} new borrowers, ${awaitingAction} awaiting action`,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
                <h1 style="color:#1a1a1a;font-size:22px;margin:0 0 4px;">Key Real Estate Capital</h1>
                <p style="color:#0d9488;font-size:14px;margin:0 0 20px;">Your weekly Loan Center digest</p>
                <p style="color:#333;font-size:15px;line-height:1.5;">${greeting}</p>
                <p style="color:#333;font-size:15px;line-height:1.5;">Here's where your borrower book stands this week: <strong>${totalBorrowers}</strong> total borrowers, <strong>${totalWithLoans}</strong> with a loan scenario.</p>
                ${section('New this week', fresh)}
                ${section('Awaiting your review', awaiting)}
                ${section('Pre-approved but no loan yet', idle)}
                <p style="margin:28px 0 0;">
                  <a href="${APP_URL}/internal/my-borrowers" style="background:#0d9488;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:6px;display:inline-block;">Open my borrowers</a>
                </p>
                <p style="color:#888;font-size:12px;margin-top:24px;">Sent every Monday &middot; Loan Center</p>
              </div>`,
          }),
        })

        if (res.ok) emailed++
        else errors++
      } catch (_err) {
        errors++
      }
    }

    return jsonRes({ aes: aes.length, emailed, skipped, errors })
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
