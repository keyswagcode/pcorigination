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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const serviceClient = createClient(
      SUPABASE_URL,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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

    const { action } = await req.json()

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

      if ((status === 'pending' || !status) && borrower?.plaid_user_id) {
        try {
          const reportData = await plaidRequest('/cra/check_report/base_report/get', {
            user_id: borrower.plaid_user_id,
          })
          const report = reportData.report || reportData

          // Compute liquidity from depository accounts
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

          // Step 1: persist the report + flip status to ready FIRST. Do this
          // before anything else so a downstream pre_approvals insert failure
          // can never strand the borrower in 'pending' forever.
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

          status = 'ready'

          // Step 2: best-effort pre-approval generation. Wrapped separately
          // so any constraint failure here doesn't bubble out and cause the
          // caller to keep polling.
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
        } catch (err) {
          // PRODUCT_NOT_READY etc. — keep status as pending so polling continues.
          const msg = (err as Error).message || ''
          if (msg.includes('NOT_READY') || msg.includes('not ready') || msg.includes('PENDING')) {
            // genuinely still generating
          } else {
            console.warn('Direct Plaid report fetch failed:', msg)
          }
        }
      }

      return new Response(JSON.stringify({
        status,
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
