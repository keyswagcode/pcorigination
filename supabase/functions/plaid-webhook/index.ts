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

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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
