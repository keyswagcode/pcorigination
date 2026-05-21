import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') || ''
const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox'
const PLAID_SECRET = PLAID_ENV === 'production'
  ? (Deno.env.get('PLAID_PRODUCTION_SECRET') || '')
  : (Deno.env.get('PLAID_SANDBOX_SECRET') || '')
const PLAID_BASE_URL = PLAID_ENV === 'production'
  ? 'https://production.plaid.com'
  : 'https://sandbox.plaid.com'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''

// Reg X §1024.39 — notice of returned ACH to borrower (+ copy to servicer)
async function sendReturnedPaymentNotice(
  serviceClient: ReturnType<typeof createClient>,
  paymentId: string,
  servicedLoanId: string,
  amount: number,
  reason: string | null,
) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping returned-payment notice')
    return
  }
  // Look up borrower + loan + servicer email
  const { data: loan } = await serviceClient
    .from('serviced_loans')
    .select('loan_number, organization_id, borrower_id')
    .eq('id', servicedLoanId)
    .maybeSingle()
  if (!loan) return
  const { data: borrower } = await serviceClient
    .from('borrowers')
    .select('borrower_name, email')
    .eq('id', loan.borrower_id)
    .maybeSingle()
  const { data: org } = await serviceClient
    .from('organizations')
    .select('name, servicing_remit_to_name, servicing_email, servicing_phone')
    .eq('id', loan.organization_id)
    .maybeSingle()
  if (!borrower?.email) {
    console.warn('No borrower email — skipping returned-payment notice')
    return
  }

  const servicer = org?.servicing_remit_to_name || org?.name || 'your servicer'
  const phone = org?.servicing_phone || '(contact info on file)'
  const servicerEmail = org?.servicing_email || null
  const fmtAmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const subject = `Notice of Returned Payment — Loan ${loan.loan_number}`
  const body = `Dear ${borrower.borrower_name?.split(' ')[0] || 'Borrower'},

This notice is to inform you that a recent ACH payment of ${fmtAmt} on loan ${loan.loan_number} was returned by your bank${reason ? ` (reason: ${reason})` : ''}.

What this means
- The amount has NOT been applied to your loan.
- Depending on your bank's policy, you may also be charged a returned-item fee by your bank.
- Per the terms of your note, a late fee may apply if the balance is not brought current within the grace period on your account.

What to do next
- Confirm sufficient funds are available in the bank account on file, then make a one-time payment from your borrower portal, OR
- Contact ${servicer} at ${phone}${servicerEmail ? ` / ${servicerEmail}` : ''} to discuss alternative payment arrangements.

If you are experiencing financial hardship, you may be eligible for loss-mitigation options. You can also contact a HUD-approved housing counselor at no cost: 1-800-569-4287.

This notice is provided pursuant to 12 CFR §1024.39 (Regulation X).

Sincerely,
${servicer} Servicing
`

  const to = [borrower.email]
  if (servicerEmail) to.push(servicerEmail)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: servicerEmail || 'servicing@keyrealestatecapital.com',
        to,
        subject,
        text: body,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      console.error('Resend returned-payment notice failed:', res.status, t.slice(0, 200))
    }
  } catch (e) {
    console.error('Resend send failed (non-fatal):', e)
  }
  void paymentId
}

async function plaidRequest(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      ...body,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error_code) {
    const msg = data.error_message || data.error_code || `Plaid ${endpoint} HTTP ${res.status}`
    console.error('Plaid error:', { endpoint, status: res.status, data })
    throw new Error(msg)
  }
  return data
}

function extractLiquidity(report: Record<string, unknown>): number {
  const items = (report as { items?: Array<Record<string, unknown>> }).items || []
  let total = 0
  for (const item of items) {
    const accounts = (item.accounts || []) as Array<Record<string, unknown>>
    for (const account of accounts) {
      if (account.type === 'depository') {
        const balances = (account.balances || {}) as Record<string, number | null>
        const balance = balances.current ?? balances.available ?? 0
        total += Number(balance) || 0
      }
    }
  }
  return total
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 })
  }

  try {
    const payload = await req.json()
    console.log('Plaid webhook received:', payload)

    const { webhook_type, webhook_code, user_id: plaidUserId } = payload

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ============================================
    // Plaid Transfer events (loan servicing ACH debits)
    // ============================================
    if (webhook_type === 'TRANSFER' || webhook_type === 'TRANSFER_EVENTS_UPDATE') {
      // Plaid's prescribed pattern: poll /transfer/event/sync from our last
      // known event_id and apply each event to the matching payment row.
      const { data: lastEventRow } = await serviceClient
        .from('serviced_loan_payments')
        .select('id')
        .order('initiated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      // For simplicity, sync from 0 every webhook. Plaid returns events in
      // batches of 25; we loop until empty.
      let afterId = 0
      let applied = 0
      let safety = 0
      while (safety++ < 20) {
        const sync = await plaidRequest('/transfer/event/sync', {
          after_id: afterId,
          count: 25,
        })
        const events = (sync.transfer_events || []) as Array<{
          event_id: number
          event_type: string
          transfer_id: string
          failure_reason?: { ach_return_code?: string; description?: string }
        }>
        if (events.length === 0) break
        for (const ev of events) {
          afterId = Math.max(afterId, ev.event_id)
          // Map Plaid event_type → our status
          const statusMap: Record<string, string> = {
            posted: 'posted',
            settled: 'posted',
            failed: 'failed',
            returned: 'returned',
            reversed: 'reversed',
            cancelled: 'failed',
            pending: 'pending',
          }
          const newStatus = statusMap[ev.event_type]
          if (!newStatus) continue

          const { data: pmt } = await serviceClient
            .from('serviced_loan_payments')
            .select('id, serviced_loan_id, schedule_id, amount, status')
            .eq('provider_transfer_id', ev.transfer_id)
            .maybeSingle()
          if (!pmt) continue
          if (pmt.status === newStatus) continue

          // On posted: split into P/I/Escrow based on the matching schedule row,
          // apply principal to serviced_loans.current_principal, mark schedule.
          if (newStatus === 'posted' && pmt.schedule_id) {
            const { data: sched } = await serviceClient
              .from('serviced_loan_schedule')
              .select('scheduled_principal, scheduled_interest, scheduled_escrow')
              .eq('id', pmt.schedule_id)
              .maybeSingle()
            if (sched) {
              await serviceClient
                .from('serviced_loan_payments')
                .update({
                  status: 'posted',
                  principal_applied: sched.scheduled_principal,
                  interest_applied: sched.scheduled_interest,
                  escrow_applied: sched.scheduled_escrow,
                  posted_at: new Date().toISOString(),
                })
                .eq('id', pmt.id)
              await serviceClient
                .from('serviced_loan_schedule')
                .update({ status: 'paid' })
                .eq('id', pmt.schedule_id)
              // Decrement principal + accrue escrow on the loan
              const { data: loan } = await serviceClient
                .from('serviced_loans')
                .select('current_principal, escrow_balance, escrow_taxes_monthly, escrow_insurance_monthly, next_payment_due_date')
                .eq('id', pmt.serviced_loan_id)
                .maybeSingle()
              if (loan) {
                await serviceClient
                  .from('serviced_loans')
                  .update({
                    current_principal: Math.max(0, Number(loan.current_principal) - Number(sched.scheduled_principal)),
                    escrow_balance: Number(loan.escrow_balance) + Number(sched.scheduled_escrow),
                  })
                  .eq('id', pmt.serviced_loan_id)
                // Move next_payment_due_date to the next 'scheduled' row
                const { data: nextSched } = await serviceClient
                  .from('serviced_loan_schedule')
                  .select('due_date')
                  .eq('serviced_loan_id', pmt.serviced_loan_id)
                  .eq('status', 'scheduled')
                  .order('payment_number', { ascending: true })
                  .limit(1)
                  .maybeSingle()
                if (nextSched) {
                  await serviceClient
                    .from('serviced_loans')
                    .update({ next_payment_due_date: nextSched.due_date })
                    .eq('id', pmt.serviced_loan_id)
                }
              }
              applied++
            }
          } else if (newStatus === 'posted' && !pmt.schedule_id) {
            // Borrower-initiated one-time payment (no schedule_id). Apply
            // the amount as a principal curtailment. (P2: full waterfall
            // — late fees first, then escrow, then accrued interest, then
            // principal. For MVP we treat one-time payments as straight
            // principal curtailments.)
            const { data: loan } = await serviceClient
              .from('serviced_loans')
              .select('current_principal')
              .eq('id', pmt.serviced_loan_id)
              .maybeSingle()
            await serviceClient
              .from('serviced_loan_payments')
              .update({
                status: 'posted',
                principal_applied: pmt.amount,
                interest_applied: 0,
                escrow_applied: 0,
                posted_at: new Date().toISOString(),
              })
              .eq('id', pmt.id)
            if (loan) {
              await serviceClient
                .from('serviced_loans')
                .update({ current_principal: Math.max(0, Number(loan.current_principal) - Number(pmt.amount)) })
                .eq('id', pmt.serviced_loan_id)
            }
            applied++
          } else {
            // returned / failed / reversed — record on the payment row, don't touch schedule
            const update: Record<string, unknown> = { status: newStatus }
            const failReason = ev.failure_reason?.description || ev.failure_reason?.ach_return_code || null
            if (newStatus === 'returned') {
              update.returned_at = new Date().toISOString()
              update.failure_reason = failReason
            }
            if (newStatus === 'failed') {
              update.failure_reason = failReason
            }
            await serviceClient
              .from('serviced_loan_payments')
              .update(update)
              .eq('id', pmt.id)

            // Reg X §1024.39 returned-payment notice (best-effort; email
            // failure shouldn't fail the whole webhook)
            if (newStatus === 'returned' || newStatus === 'failed') {
              await sendReturnedPaymentNotice(
                serviceClient,
                pmt.id,
                pmt.serviced_loan_id,
                Number(pmt.amount),
                failReason,
              ).catch(e => console.error('sendReturnedPaymentNotice:', e))
            }
          }
        }
        if (events.length < 25) break
      }
      // Silence unused var warning
      void lastEventRow
      return new Response(JSON.stringify({ ok: true, applied }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Only handle Plaid Check report events for now
    if (webhook_type !== 'CHECK_REPORT') {
      return new Response(JSON.stringify({ ok: true, ignored: webhook_type }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!plaidUserId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: borrower, error: borrowerError } = await serviceClient
      .from('borrowers')
      .select('id, user_id')
      .eq('plaid_user_id', plaidUserId)
      .maybeSingle()

    if (borrowerError) throw borrowerError
    if (!borrower) {
      console.warn('No borrower found for plaid_user_id', plaidUserId)
      return new Response(JSON.stringify({ ok: true, note: 'unknown user' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (webhook_code === 'USER_CHECK_REPORT_ERROR' || webhook_code === 'CHECK_REPORT_ERROR') {
      await serviceClient
        .from('borrowers')
        .update({ plaid_report_status: 'error' })
        .eq('id', borrower.id)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (webhook_code !== 'USER_CHECK_REPORT_READY' && webhook_code !== 'CHECK_REPORT_READY') {
      return new Response(JSON.stringify({ ok: true, ignored: webhook_code }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fetch the base report
    const reportData = await plaidRequest('/cra/check_report/base_report/get', {
      user_id: plaidUserId,
    })

    const report = reportData.report || reportData
    const totalLiquidity = extractLiquidity(report)

    // Step 1: persist the financial profile + flip status to ready FIRST so
    // a pre_approvals insert failure can't keep the borrower stuck in
    // 'pending'.
    await serviceClient.from('borrower_financial_profiles').upsert({
      borrower_id: borrower.id,
      liquidity_estimate: totalLiquidity,
      ending_balance_avg: totalLiquidity,
      confidence_score: 95,
      summary: {
        source: 'plaid_cra_base_report',
        verified_at: new Date().toISOString(),
        total_liquidity: totalLiquidity,
        report,
      },
    }, { onConflict: 'borrower_id' })

    await serviceClient
      .from('borrowers')
      .update({
        plaid_report_status: 'ready',
        lifecycle_stage: totalLiquidity > 0 ? 'pre_approved' : 'liquidity_verified',
        ...(totalLiquidity > 0 ? { borrower_status: 'prequalified' } : {}),
      })
      .eq('id', borrower.id)

    // Step 2: best-effort pre-approval generation.
    if (totalLiquidity > 0) {
      try {
        await serviceClient.from('pre_approvals').delete().eq('borrower_id', borrower.id)
        await serviceClient.from('pre_approvals').insert([
          {
            borrower_id: borrower.id,
            loan_type: 'dscr',
            status: 'approved',
            sub_status: 'pre_approved',
            prequalified_amount: totalLiquidity * 4,
            qualification_max: totalLiquidity * 4,
            verified_liquidity: totalLiquidity,
            passes_liquidity_check: true,
            summary: `DSCR Loan Pre-Approval: Up to $${(totalLiquidity * 4).toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (4x multiplier)`,
            machine_decision: 'approved',
            machine_confidence: 95,
          },
          {
            borrower_id: borrower.id,
            loan_type: 'fix_flip',
            status: 'approved',
            sub_status: 'pre_approved',
            prequalified_amount: totalLiquidity * 10,
            qualification_max: totalLiquidity * 10,
            verified_liquidity: totalLiquidity,
            passes_liquidity_check: true,
            summary: `Fix & Flip Pre-Approval: Up to $${(totalLiquidity * 10).toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (10x multiplier)`,
            machine_decision: 'approved',
            machine_confidence: 95,
          },
          {
            borrower_id: borrower.id,
            loan_type: 'bridge',
            status: 'approved',
            sub_status: 'pre_approved',
            prequalified_amount: totalLiquidity * 5,
            qualification_max: totalLiquidity * 5,
            verified_liquidity: totalLiquidity,
            passes_liquidity_check: true,
            summary: `Bridge Loan Pre-Approval: Up to $${(totalLiquidity * 5).toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (5x multiplier)`,
            machine_decision: 'approved',
            machine_confidence: 95,
          },
        ])
      } catch (paErr) {
        console.warn('Auto pre_approval insert failed (status still ready):', (paErr as Error).message)
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
