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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const PLAID_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/plaid-webhook`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---- Qualifying income from the Plaid CRA base report ----
// Mirrors src/lib/incomeEstimator.ts: count income inflows on depository
// accounts, excluding transfers, refunds, credit-card/loan payments, and fees.
// Monthly income = total qualifying inflows / months actually covered.
const INCOME_PRIMARY = new Set(['INCOME'])
const INCOME_LEGACY = new Set(['payroll', 'wages', 'salary', 'interest', 'dividends', 'retirement', 'pension'])
const EXCLUDE_PRIMARY = new Set(['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'BANK_FEES'])
const EXCLUDE_LEGACY = new Set(['transfer', 'credit', 'refund', 'reimbursement', 'cash advance', 'payment', 'fee', 'atm'])

function isIncomeTx(tx: Record<string, unknown>): boolean {
  // CRA base-report transactions categorize under `credit_category`
  // (not `personal_finance_category`), and inflows are signed NEGATIVE — so we
  // categorize by the INCOME bucket and ignore sign (use abs in the sum).
  const cc = (tx?.credit_category as { primary?: string } | null)?.primary
    || (tx?.personal_finance_category as { primary?: string } | null)?.primary
  if (cc) {
    if (EXCLUDE_PRIMARY.has(cc)) return false
    return INCOME_PRIMARY.has(cc)
  }
  const cats = ((tx?.category as string[] | null) || []).map((c) => String(c).toLowerCase())
  if (cats.length === 0) return false
  if (cats.some((c) => EXCLUDE_LEGACY.has(c))) return false
  return cats.some((c) => INCOME_LEGACY.has(c))
}

function computeQualifyingIncome(report: Record<string, unknown> | null | undefined): {
  monthlyIncome: number; annualIncome: number; monthsCovered: number
} {
  const items = (report?.items || []) as Array<Record<string, unknown>>
  let total = 0
  let earliest: number | null = null
  let latest: number | null = null
  for (const item of items) {
    for (const acct of (item.accounts || []) as Array<Record<string, unknown>>) {
      if (acct.type !== 'depository') continue
      for (const tx of (acct.transactions || []) as Array<Record<string, unknown>>) {
        const dateStr = tx?.date as string | undefined
        if (!dateStr) continue
        const t = new Date(dateStr).getTime()
        if (isNaN(t)) continue
        if (!isIncomeTx(tx)) continue
        total += Math.abs(Number(tx.amount) || 0)
        if (earliest === null || t < earliest) earliest = t
        if (latest === null || t > latest) latest = t
      }
    }
  }
  if (total <= 0 || earliest === null || latest === null) {
    return { monthlyIncome: 0, annualIncome: 0, monthsCovered: 0 }
  }
  const monthsCovered = Math.max(1, Math.round(((latest - earliest) / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10)
  const monthlyIncome = Math.round(total / monthsCovered)
  return { monthlyIncome, annualIncome: monthlyIncome * 12, monthsCovered }
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
    const msg = data.display_message || data.error_message || data.error_code || `Plaid ${endpoint} HTTP ${res.status}`
    console.error('Plaid error:', { endpoint, status: res.status, data })
    throw new Error(msg)
  }
  return data
}

function splitName(borrowerName: string | null, fallbackFirst?: string | null, fallbackLast?: string | null) {
  if (fallbackFirst || fallbackLast) {
    return { given_name: fallbackFirst || '', family_name: fallbackLast || '' }
  }
  const parts = (borrowerName || '').trim().split(/\s+/)
  return {
    given_name: parts[0] || '',
    family_name: parts.slice(1).join(' ') || '',
  }
}

// Keep only what we persist + later re-read: depository accounts and the
// transaction fields the income estimator uses. A full CRA report with several
// linked banks and 24 months of transactions is huge; storing it whole in the
// profile.summary jsonb on every poll made multi-account upserts slow enough to
// time out. This slims it to the essentials (liquidity + income re-computation)
// without changing what the broker UI shows.
// deno-lint-ignore no-explicit-any
function slimReport(report: any): Record<string, unknown> {
  const items = (report?.items || []) as Array<Record<string, unknown>>
  return {
    items: items.map((item) => ({
      accounts: ((item.accounts || []) as Array<Record<string, unknown>>)
        .filter((a) => a.type === 'depository')
        .map((a) => ({
          type: a.type,
          subtype: a.subtype,
          name: a.name,
          balances: a.balances,
          transactions: ((a.transactions || []) as Array<Record<string, unknown>>).map((t) => ({
            date: t.date,
            amount: t.amount,
            name: t.name,
            credit_category: t.credit_category,
            personal_finance_category: t.personal_finance_category,
            category: t.category,
          })),
        })),
    })),
  }
}

// Fetch the borrower's CRA base report from Plaid and persist liquidity,
// income, DTI, status, and auto pre-approvals. Shared by the user-facing
// get_report_status poll AND the sweep_pending cron, so the store logic lives
// in exactly one place. Returns the resolved status.
// deno-lint-ignore no-explicit-any
async function processBorrowerReport(serviceClient: any, borrower: { id: string; plaid_user_id: string }): Promise<{ status: string; detail?: string }> {
  try {
    const reportData = await plaidRequest('/cra/check_report/base_report/get', {
      user_id: borrower.plaid_user_id,
    })
    const report = reportData.report || reportData

    let totalLiquidity = 0
    const items = (report?.items || []) as Array<Record<string, unknown>>
    for (const item of items) {
      const accounts = (item.accounts || []) as Array<Record<string, unknown>>
      for (const acct of accounts) {
        if (acct.type === 'depository') {
          const balances = (acct.balances || {}) as Record<string, number | null>
          const balance = balances.current ?? balances.available ?? 0
          totalLiquidity += Number(balance) || 0
        }
      }
    }

    const income = computeQualifyingIncome(report)

    const { data: existingProf } = await serviceClient
      .from('borrower_financial_profiles')
      .select('monthly_debt')
      .eq('borrower_id', borrower.id)
      .maybeSingle()
    const monthlyDebt = Number((existingProf as { monthly_debt?: number } | null)?.monthly_debt) || 0
    const dti = (income.monthlyIncome > 0 && monthlyDebt > 0)
      ? Math.round((monthlyDebt / income.monthlyIncome) * 1000) / 10
      : null

    await serviceClient.from('borrower_financial_profiles').upsert({
      borrower_id: borrower.id,
      liquidity_estimate: totalLiquidity,
      ending_balance_avg: totalLiquidity,
      monthly_income: income.monthlyIncome,
      income_estimate: income.annualIncome,
      income_method: 'plaid_cra_qualifying',
      income_months: income.monthsCovered,
      ...(dti != null ? { dti, dti_computed_at: new Date().toISOString() } : {}),
      confidence_score: 95,
      summary: {
        source: 'plaid_cra_base_report',
        verified_at: new Date().toISOString(),
        total_liquidity: totalLiquidity,
        monthly_income: income.monthlyIncome,
        income_months: income.monthsCovered,
        report: slimReport(report),
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
    return { status: 'ready' }
  } catch (err) {
    const msg = (err as Error).message || ''
    // Still generating. Plaid generates the base report ASYNC after the user
    // finishes Link, so for a window right after a successful link
    // base_report/get returns "report does not exist" (the report object isn't
    // created yet) — that is transient, NOT a reason to tell the borrower to
    // reconnect. Keep polling; the readiness/error webhook (or a later poll)
    // resolves it. Genuine failures arrive as USER_CHECK_REPORT_ERROR (webhook
    // → status 'error') or DATA_QUALITY (handled below).
    if (
      msg.includes('NOT_READY') || msg.includes('not ready') || msg.includes('PENDING') ||
      msg.includes('does not exist') || msg.includes('reconnect')
    ) {
      return { status: 'pending' }
    }

    // DATA_QUALITY_CHECK_FAILED — the bank returned inconsistent transaction
    // history. Plaid's documented remediation is to regenerate a fresh report
    // (/cra/check_report/create) with the latest bank data. Do it at most once
    // per 24h per borrower (so a persistently-bad bank can't loop), then keep
    // the borrower 'pending' so the poll + recovery sweep pick up the new
    // report. If it already failed again within 24h, treat as terminal.
    const isDataQuality = /DATA_QUALITY|inconsistent transaction|high chance of error|resolve issues/i.test(msg)
    if (isDataQuality) {
      const { data: b } = await serviceClient
        .from('borrowers')
        .select('plaid_report_regenerated_at')
        .eq('id', borrower.id)
        .maybeSingle()
      const last = b?.plaid_report_regenerated_at ? new Date(b.plaid_report_regenerated_at).getTime() : 0
      if (Date.now() - last > 24 * 60 * 60 * 1000) {
        try {
          await plaidRequest('/cra/check_report/create', {
            user_id: borrower.plaid_user_id,
            days_requested: 365,
            consumer_report_permissible_purpose: 'WRITTEN_INSTRUCTION_PREQUALIFICATION',
            webhook: PLAID_WEBHOOK_URL,
          })
          await serviceClient
            .from('borrowers')
            .update({ plaid_report_status: 'pending', plaid_report_regenerated_at: new Date().toISOString() })
            .eq('id', borrower.id)
          console.log('Regenerated CRA report after data-quality failure for', borrower.id)
          return { status: 'pending' }
        } catch (regenErr) {
          console.warn('CRA report regenerate failed:', (regenErr as Error).message)
          // fall through to terminal error
        }
      }
    }

    console.warn('Direct Plaid report fetch failed terminally:', msg)
    await serviceClient
      .from('borrowers')
      .update({ plaid_report_status: 'error' })
      .eq('id', borrower.id)
    return { status: 'error', detail: msg }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const serviceClient = createClient(
      SUPABASE_URL,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json().catch(() => ({}))
    const { action } = body

    // SWEEP PENDING — invoked by the recovery cron, not a user. Re-checks every
    // borrower stuck in plaid_report_status='pending' (e.g. a missed webhook)
    // and resolves them to ready/error. Unauthenticated like the other internal
    // crons in this project: it takes no input and returns no PII, only counts;
    // the worst an external caller can do is trigger Plaid re-checks already
    // owed to pending borrowers.
    if (action === 'sweep_pending') {
      const { data: pending } = await serviceClient
        .from('borrowers')
        .select('id, plaid_user_id')
        .eq('plaid_report_status', 'pending')
        .not('plaid_user_id', 'is', null)
      let ready = 0, errored = 0, stillPending = 0
      for (const b of (pending || []) as Array<{ id: string; plaid_user_id: string }>) {
        const r = await processBorrowerReport(serviceClient, b)
        if (r.status === 'ready') ready++
        else if (r.status === 'error') errored++
        else stillPending++
      }
      return new Response(JSON.stringify({ swept: (pending || []).length, ready, errored, stillPending }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: `Auth failed: ${authError?.message || 'no user returned'}` }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // CREATE LINK TOKEN (also creates a Plaid user if one doesn't exist yet)
    if (action === 'create_link_token') {
      const { data: borrower, error: borrowerError } = await serviceClient
        .from('borrowers')
        .select('id, borrower_name, email, phone, date_of_birth, ssn_encrypted, address_street, address_city, address_state, address_zip, plaid_user_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (borrowerError) throw borrowerError
      if (!borrower) throw new Error('Borrower profile not found. Complete your profile first.')

      const { data: account } = await serviceClient
        .from('user_accounts')
        .select('first_name, last_name')
        .eq('id', user.id)
        .maybeSingle()

      const name = splitName(borrower.borrower_name, account?.first_name, account?.last_name)
      const ssnDigits = (borrower.ssn_encrypted || '').replace(/\D/g, '')

      const identity: Record<string, unknown> = { name }
      if (borrower.date_of_birth) identity.date_of_birth = borrower.date_of_birth
      const email = borrower.email || user.email
      if (email) identity.emails = [{ data: email, primary: true }]
      if (borrower.phone) {
        const raw = borrower.phone.replace(/\D/g, '')
        const ten = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw
        // NANP validation: 10 digits, area code first digit 2-9, exchange first digit 2-9,
        // not a 555 reserved prefix (555-01XX is for fictional use).
        const valid = ten.length === 10
          && /^[2-9]/.test(ten)
          && /^.{3}[2-9]/.test(ten)
          && !(ten.slice(3, 6) === '555' && ten.slice(6, 8) === '01')
        if (valid) identity.phone_numbers = [{ data: `+1${ten}`, primary: true }]
      }
      if (borrower.address_street && borrower.address_city && borrower.address_state && borrower.address_zip) {
        identity.addresses = [{
          street_1: borrower.address_street,
          city: borrower.address_city,
          region: borrower.address_state,
          postal_code: borrower.address_zip,
          country: 'US',
          primary: true,
        }]
      }
      // SSA validity: area 001-665 or 667-899; group != 00; serial != 0000
      const isValidFullSsn = (s: string) => {
        if (s.length !== 9) return false
        const area = parseInt(s.slice(0, 3), 10)
        const group = s.slice(3, 5)
        const serial = s.slice(5, 9)
        if (area === 0 || area === 666 || area >= 900) return false
        if (group === '00') return false
        if (serial === '0000') return false
        return true
      }
      if (ssnDigits.length === 9 && isValidFullSsn(ssnDigits)) {
        identity.id_numbers = [{ type: 'us_ssn', value: ssnDigits }]
      } else if (ssnDigits.length >= 4) {
        // Fall back to last-4 if full SSN is malformed; Plaid validates last-4 less strictly.
        identity.id_numbers = [{ type: 'us_ssn_last_4', value: ssnDigits.slice(-4) }]
      }

      // Redacted diagnostic — never logs raw SSN or full phone
      const redactedIdentity = {
        has_name: !!(name.given_name && name.family_name),
        has_dob: !!identity.date_of_birth,
        has_email: !!identity.emails,
        has_phone: !!identity.phone_numbers,
        has_address: !!identity.addresses,
        ssn_type: ssnDigits.length === 9 ? 'us_ssn' : ssnDigits.length === 4 ? 'us_ssn_last_4' : 'missing',
        ssn_length: ssnDigits.length,
      }
      console.log('Plaid identity built for borrower', borrower.id, redactedIdentity)

      let plaidUserId = borrower.plaid_user_id
      let tokenData: Record<string, unknown>

      try {
        if (!plaidUserId) {
          const userData = await plaidRequest('/user/create', {
            client_user_id: user.id,
            identity,
          })
          plaidUserId = userData.user_id

          await serviceClient
            .from('borrowers')
            .update({ plaid_user_id: plaidUserId })
            .eq('id', borrower.id)
        } else {
          await plaidRequest('/user/update', {
            user_id: plaidUserId,
            identity,
          })
        }

        tokenData = await plaidRequest('/link/token/create', {
          user_id: plaidUserId,
          client_name: 'Key Real Estate Capital',
          products: ['cra_base_report'],
          consumer_report_permissible_purpose: 'WRITTEN_INSTRUCTION_PREQUALIFICATION',
          cra_options: { days_requested: 365 },
          country_codes: ['US'],
          language: 'en',
          webhook: PLAID_WEBHOOK_URL,
        })
      } catch (err) {
        const baseMsg = (err as Error).message
        throw new Error(`${baseMsg} | identity_check: ${JSON.stringify(redactedIdentity)}`)
      }

      return new Response(JSON.stringify({ link_token: tokenData.link_token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // LINK SUCCESS — borrower completed Plaid Link; report generation begins async.
    // No public_token exchange is needed for Plaid Check products.
    if (action === 'link_success') {
      const { error: updateError } = await serviceClient
        .from('borrowers')
        .update({
          plaid_report_status: 'pending',
          lifecycle_stage: 'liquidity_pending',
        })
        .eq('user_id', user.id)

      if (updateError) throw updateError

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Polling endpoint so the borrower UI can check report status.
    // If status is still 'pending', we also attempt to fetch the report
    // directly from Plaid in case the webhook never fired or is delayed.
    if (action === 'get_report_status') {
      const { data: borrower } = await serviceClient
        .from('borrowers')
        .select('id, plaid_report_status, plaid_user_id')
        .eq('user_id', user.id)
        .maybeSingle()

      let status = borrower?.plaid_report_status || null
      let statusDetail: string | null = null

      if ((status === 'pending' || !status) && borrower?.plaid_user_id) {
        const result = await processBorrowerReport(serviceClient, { id: borrower.id, plaid_user_id: borrower.plaid_user_id })
        if (result.status !== 'pending') status = result.status
        statusDetail = result.detail ?? null
      }

      return new Response(JSON.stringify({
        status,
        ...(statusDetail ? { detail: statusDetail } : {}),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
