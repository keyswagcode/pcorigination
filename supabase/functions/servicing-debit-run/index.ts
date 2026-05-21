import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// Two modes:
//   - mode: 'cron'   → invoked by pg_cron; finds all schedule rows due today
//                       with an active ACH auth and not yet debited, runs each.
//   - mode: 'single' → invoked synchronously from the admin "Force-debit"
//                       button; runs exactly one schedule row.
//
// Idempotency: we never create a second pending payment for the same
// schedule_id on the same calendar day.

const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') || ''
const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox'
const PLAID_SECRET = PLAID_ENV === 'production'
  ? (Deno.env.get('PLAID_PRODUCTION_SECRET') || '')
  : (Deno.env.get('PLAID_SANDBOX_SECRET') || '')
const PLAID_BASE_URL = PLAID_ENV === 'production'
  ? 'https://production.plaid.com'
  : 'https://sandbox.plaid.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const PLAID_TRANSFER_MODE = Deno.env.get('PLAID_TRANSFER_MODE') || 'sandbox'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function plaidRequest(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  })
  const data = await res.json()
  if (!res.ok || data.error_code) {
    const msg = data.display_message || data.error_message || data.error_code || `Plaid ${endpoint} HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

interface ScheduleRow {
  id: string
  serviced_loan_id: string
  payment_number: number
  due_date: string
  scheduled_principal: number
  scheduled_interest: number
  scheduled_escrow: number
  scheduled_total: number
  status: string
}

async function debitOne(serviceClient: ReturnType<typeof createClient>, row: ScheduleRow): Promise<{ ok: boolean; transfer_id?: string; error?: string }> {
  // 1. Idempotency: any payment already attempted today for this schedule row?
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await serviceClient
    .from('serviced_loan_payments')
    .select('id, status, provider_transfer_id, initiated_at')
    .eq('schedule_id', row.id)
    .gte('initiated_at', `${today}T00:00:00Z`)
    .lt('initiated_at', `${today}T23:59:59Z`)
    .limit(1)
    .maybeSingle()
  if (existing) return { ok: true, transfer_id: existing.provider_transfer_id || undefined }

  // 2. Look up active ACH authorization for the loan
  const { data: auth } = await serviceClient
    .from('serviced_loan_ach_authorizations')
    .select('id, provider, provider_account_id, provider_access_token_encrypted, account_holder_name')
    .eq('serviced_loan_id', row.serviced_loan_id)
    .eq('status', 'active')
    .order('authorized_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!auth || !auth.provider_access_token_encrypted) {
    return { ok: false, error: 'No active ACH authorization' }
  }

  // 3. Plaid Transfer authorization + create
  let transferId: string | null = null
  let failureReason: string | null = null
  try {
    const authRes = await plaidRequest('/transfer/authorization/create', {
      access_token: auth.provider_access_token_encrypted,
      account_id: auth.provider_account_id,
      type: 'debit',
      network: 'ach',
      amount: Number(row.scheduled_total).toFixed(2),
      ach_class: 'ppd',
      user: { legal_name: auth.account_holder_name || 'Borrower' },
      iso_currency_code: 'USD',
    })
    if (authRes?.authorization?.decision !== 'approved') {
      throw new Error(`Plaid rejected: ${authRes?.authorization?.decision_rationale?.description || authRes?.authorization?.decision}`)
    }
    const tx = await plaidRequest('/transfer/create', {
      access_token: auth.provider_access_token_encrypted,
      account_id: auth.provider_account_id,
      authorization_id: authRes.authorization.id,
      description: `Loan pmt #${row.payment_number}`,
      amount: Number(row.scheduled_total).toFixed(2),
    })
    transferId = tx?.transfer?.id || null
  } catch (e) {
    failureReason = e instanceof Error ? e.message : String(e)
  }

  // 4. Insert pending payment row regardless — failed transfers also get logged
  const { error: insErr } = await serviceClient.from('serviced_loan_payments').insert({
    serviced_loan_id: row.serviced_loan_id,
    schedule_id: row.id,
    amount: row.scheduled_total,
    principal_applied: 0,
    interest_applied: 0,
    escrow_applied: 0,
    fees_applied: 0,
    payment_method: 'ach',
    provider: 'plaid_transfer',
    provider_transfer_id: transferId,
    provider_authorization_id: null,
    status: transferId ? 'pending' : 'failed',
    failure_reason: failureReason,
    initiated_at: new Date().toISOString(),
  })
  if (insErr) return { ok: false, error: insErr.message }

  // 5. Touch last_used_at on the auth
  await serviceClient
    .from('serviced_loan_ach_authorizations')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', auth.id)

  return transferId ? { ok: true, transfer_id: transferId } : { ok: false, error: failureReason || 'unknown' }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // pg_cron invocations use a service-role key in the Authorization header;
    // admin "Force-debit" clicks use the broker's session token. Either way
    // we just trust the call here and rely on the cron / RLS for authz.
    const body = await req.json().catch(() => ({}))
    const mode = body.mode || 'cron'

    if (mode === 'single') {
      const { schedule_id, serviced_loan_id } = body
      if (!schedule_id || !serviced_loan_id) return jsonRes({ error: 'Missing schedule_id or serviced_loan_id' }, 400)
      const { data: row, error } = await serviceClient
        .from('serviced_loan_schedule')
        .select('id, serviced_loan_id, payment_number, due_date, scheduled_principal, scheduled_interest, scheduled_escrow, scheduled_total, status')
        .eq('id', schedule_id)
        .maybeSingle()
      if (error || !row) return jsonRes({ error: 'Schedule row not found' }, 404)
      const result = await debitOne(serviceClient, row as ScheduleRow)
      return jsonRes({ ok: result.ok, transfer_id: result.transfer_id, error: result.error, mode: PLAID_TRANSFER_MODE })
    }

    if (mode === 'borrower_one_time') {
      // Borrower-initiated debit for an arbitrary amount. Reuses the same
      // Plaid Transfer flow as scheduled debits but never references a
      // schedule_id (so the webhook applies it as a curtailment, not against
      // a specific scheduled row).
      const { serviced_loan_id, amount } = body
      if (!serviced_loan_id || !amount) return jsonRes({ error: 'Missing serviced_loan_id or amount' }, 400)
      const amt = Number(amount)
      if (!isFinite(amt) || amt < 1 || amt > 100000) return jsonRes({ error: 'Amount must be 1–100000' }, 400)

      const { data: loan } = await serviceClient
        .from('serviced_loans')
        .select('id')
        .eq('id', serviced_loan_id)
        .maybeSingle()
      if (!loan) return jsonRes({ error: 'Loan not found' }, 404)

      const { data: auth } = await serviceClient
        .from('serviced_loan_ach_authorizations')
        .select('id, provider_account_id, provider_access_token_encrypted, account_holder_name')
        .eq('serviced_loan_id', serviced_loan_id)
        .eq('status', 'active')
        .order('authorized_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!auth || !auth.provider_access_token_encrypted) {
        return jsonRes({ error: 'No active ACH authorization — set up Auto-Pay first' }, 400)
      }

      let transferId: string | null = null
      let failureReason: string | null = null
      try {
        const authRes = await plaidRequest('/transfer/authorization/create', {
          access_token: auth.provider_access_token_encrypted,
          account_id: auth.provider_account_id,
          type: 'debit',
          network: 'ach',
          amount: amt.toFixed(2),
          ach_class: 'ppd',
          user: { legal_name: auth.account_holder_name || 'Borrower' },
          iso_currency_code: 'USD',
        })
        if (authRes?.authorization?.decision !== 'approved') {
          throw new Error(`Plaid rejected: ${authRes?.authorization?.decision_rationale?.description || authRes?.authorization?.decision}`)
        }
        const tx = await plaidRequest('/transfer/create', {
          access_token: auth.provider_access_token_encrypted,
          account_id: auth.provider_account_id,
          authorization_id: authRes.authorization.id,
          description: 'Borrower one-time payment',
          amount: amt.toFixed(2),
        })
        transferId = tx?.transfer?.id || null
      } catch (e) {
        failureReason = e instanceof Error ? e.message : String(e)
      }

      const { data: pmt, error: insErr } = await serviceClient.from('serviced_loan_payments').insert({
        serviced_loan_id,
        schedule_id: null,
        amount: amt,
        payment_method: 'ach',
        provider: 'plaid_transfer',
        provider_transfer_id: transferId,
        status: transferId ? 'pending' : 'failed',
        failure_reason: failureReason,
        initiated_at: new Date().toISOString(),
      }).select('id').single()
      if (insErr) return jsonRes({ error: insErr.message }, 500)

      await serviceClient
        .from('serviced_loan_ach_authorizations')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', auth.id)

      return jsonRes({ ok: !!transferId, payment_id: pmt?.id, transfer_id: transferId, error: failureReason, mode: PLAID_TRANSFER_MODE })
    }

    if (mode === 'cron') {
      const today = new Date().toISOString().slice(0, 10)
      const { data: dueRows, error } = await serviceClient
        .from('serviced_loan_schedule')
        .select('id, serviced_loan_id, payment_number, due_date, scheduled_principal, scheduled_interest, scheduled_escrow, scheduled_total, status')
        .eq('due_date', today)
        .in('status', ['scheduled', 'late'])
      if (error) throw error

      const results: Array<{ schedule_id: string; ok: boolean; transfer_id?: string; error?: string }> = []
      for (const row of (dueRows || []) as ScheduleRow[]) {
        const r = await debitOne(serviceClient, row)
        results.push({ schedule_id: row.id, ...r })
      }
      return jsonRes({ ok: true, mode: PLAID_TRANSFER_MODE, processed: results.length, results })
    }

    return jsonRes({ error: 'Unknown mode' }, 400)
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
