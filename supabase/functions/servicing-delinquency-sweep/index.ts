import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// Nightly sweep:
//   1. For every 'scheduled' row whose due_date + grace_period_days < today
//      AND has no posted payment → flip to 'late', bump that row's
//      scheduled_total by the loan's late_fee_amount, mark the loan
//      servicing_status='delinquent'.
//   2. (No-op for already-late rows — idempotent.)
//
// We do NOT do borrower-facing "loss mitigation" emails here yet —
// Reg X §1024.41 timelines (45-day welcome, 36-day live contact) are
// P2. Late-fee + status flip is the MVP.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // SQL-driven sweep: one statement to find all overdue rows + assess
    // late fees + flip statuses. Keeps everything in a single transaction.
    const today = new Date().toISOString().slice(0, 10)

    // Find overdue scheduled rows. Done in JS so we can iterate; small N
    // (~few hundred at most for KREC's volume early on).
    const { data: overdueRows, error } = await serviceClient.rpc('servicing_find_overdue_rows', { p_today: today })

    // Fallback if the RPC doesn't exist yet (it's optional): do it client-side
    let rows = overdueRows as Array<{ schedule_id: string; serviced_loan_id: string; late_fee: number; due_date: string }> | null
    if (error || !rows) {
      const { data: candidates } = await serviceClient
        .from('serviced_loan_schedule')
        .select(`
          id,
          serviced_loan_id,
          due_date,
          status,
          serviced_loans!inner(id, late_fee_amount, grace_period_days, servicing_status)
        `)
        .eq('status', 'scheduled')
      rows = []
      for (const r of (candidates || []) as Array<Record<string, unknown>>) {
        const loan = r.serviced_loans as { id: string; late_fee_amount: number; grace_period_days: number; servicing_status: string }
        const dueDate = new Date(r.due_date + 'T00:00:00Z')
        const grace = loan.grace_period_days || 0
        const cutoff = new Date(dueDate)
        cutoff.setUTCDate(cutoff.getUTCDate() + grace)
        const todayDate = new Date(today + 'T00:00:00Z')
        if (todayDate > cutoff) {
          rows!.push({
            schedule_id: r.id as string,
            serviced_loan_id: loan.id,
            late_fee: Number(loan.late_fee_amount || 0),
            due_date: r.due_date as string,
          })
        }
      }
    }

    let flipped = 0
    let loansMarkedDelinquent = 0
    const affectedLoanIds = new Set<string>()

    for (const r of rows) {
      // Idempotent: re-running on the same row makes no further changes
      // because the row will already be 'late' on subsequent runs.
      const { data: sched } = await serviceClient
        .from('serviced_loan_schedule')
        .select('id, status, scheduled_total')
        .eq('id', r.schedule_id)
        .maybeSingle()
      if (!sched || sched.status !== 'scheduled') continue

      await serviceClient
        .from('serviced_loan_schedule')
        .update({
          status: 'late',
          scheduled_total: Number(sched.scheduled_total) + Number(r.late_fee || 0),
        })
        .eq('id', r.schedule_id)
      flipped++
      affectedLoanIds.add(r.serviced_loan_id)
    }

    // Mark affected loans delinquent (only those currently 'active')
    for (const loanId of affectedLoanIds) {
      const { data: loan } = await serviceClient
        .from('serviced_loans')
        .select('servicing_status')
        .eq('id', loanId)
        .maybeSingle()
      if (loan?.servicing_status === 'active') {
        await serviceClient
          .from('serviced_loans')
          .update({ servicing_status: 'delinquent' })
          .eq('id', loanId)
        loansMarkedDelinquent++
      }
    }

    return jsonRes({ ok: true, today, overdue_rows_processed: rows.length, schedule_rows_flipped: flipped, loans_marked_delinquent: loansMarkedDelinquent })
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
