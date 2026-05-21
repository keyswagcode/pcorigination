import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// Plaid Link in auth + transfer mode → exchange public_token → create
// a recurring Transfer authorization → store in serviced_loan_ach_authorizations.
// Borrower-initiated. The serviced_loan must already exist (admin onboards it first).

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
// 'sandbox' (test mode, no real money) | 'production' (real money — requires Plaid Transfer underwriting)
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
    console.error('Plaid error:', { endpoint, status: res.status, data })
    throw new Error(msg)
  }
  return data
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonRes({ error: 'No authorization header' }, 401)
    const { data: { user } } = await serviceClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return jsonRes({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const { action, serviced_loan_id } = body

    if (!serviced_loan_id) return jsonRes({ error: 'Missing serviced_loan_id' }, 400)

    // Make sure the requester can access this loan via RLS (read fails otherwise)
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: loan, error: loanErr } = await userClient
      .from('serviced_loans')
      .select('id, organization_id, borrower_id, loan_number, current_principal')
      .eq('id', serviced_loan_id)
      .maybeSingle()
    if (loanErr || !loan) return jsonRes({ error: 'Loan not found or no access' }, 404)

    if (action === 'create_link_token') {
      // Get the borrower's display name to seed Plaid Link
      const { data: borrower } = await serviceClient
        .from('borrowers')
        .select('borrower_name, email, user_id')
        .eq('id', loan.borrower_id)
        .maybeSingle()

      const products: string[] = ['auth']
      if (PLAID_TRANSFER_MODE !== 'disabled') products.push('transfer')

      const linkRes = await plaidRequest('/link/token/create', {
        client_name: 'Loan Servicing',
        language: 'en',
        country_codes: ['US'],
        user: { client_user_id: borrower?.user_id || user.id },
        products,
        webhook: PLAID_WEBHOOK_URL,
      })
      return jsonRes({ ok: true, link_token: linkRes.link_token })
    }

    if (action === 'exchange_public_token') {
      const { public_token, account_id, account_mask, bank_name, account_holder_name } = body
      if (!public_token || !account_id) return jsonRes({ error: 'Missing public_token or account_id' }, 400)

      const exch = await plaidRequest('/item/public_token/exchange', { public_token })
      const accessToken = exch.access_token as string

      // Create a Plaid Transfer recurring authorization for the next 12 months
      // worth of debits up to a ceiling. We re-authorize each individual debit
      // at debit time too — this is just the umbrella mandate.
      const ceiling = Number(loan.current_principal || 0) * 0.05  // 5% of balance as monthly ceiling — generous
      let authorizationId: string | null = null
      let plaidErr: string | null = null
      try {
        const auth = await plaidRequest('/transfer/authorization/create', {
          access_token: accessToken,
          account_id,
          type: 'debit',
          network: 'ach',
          amount: ceiling.toFixed(2),
          ach_class: 'ppd',
          user: {
            legal_name: account_holder_name || 'Borrower',
          },
          // Recurring intent marker — Plaid uses this for risk + compliance
          iso_currency_code: 'USD',
        })
        authorizationId = auth?.authorization?.id || null
      } catch (e) {
        plaidErr = e instanceof Error ? e.message : String(e)
        // Don't fail the whole call — store the access token so admin can retry later
      }

      const { data: row, error: insertErr } = await serviceClient
        .from('serviced_loan_ach_authorizations')
        .insert({
          serviced_loan_id,
          provider: 'plaid_transfer',
          provider_account_id: account_id,
          provider_access_token_encrypted: accessToken, // P2: encrypt with pgsodium
          authorization_id: authorizationId,
          authorized_amount_ceiling: ceiling,
          account_mask: account_mask || null,
          bank_name: bank_name || null,
          account_holder_name: account_holder_name || null,
          status: 'active',
        })
        .select('id')
        .single()
      if (insertErr) throw insertErr

      return jsonRes({ ok: true, id: row?.id, mode: PLAID_TRANSFER_MODE, plaid_authorization_id: authorizationId, plaid_warning: plaidErr })
    }

    if (action === 'revoke') {
      const { auth_id } = body
      if (!auth_id) return jsonRes({ error: 'Missing auth_id' }, 400)
      const { error: updErr } = await serviceClient
        .from('serviced_loan_ach_authorizations')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', auth_id)
      if (updErr) throw updErr
      return jsonRes({ ok: true })
    }

    return jsonRes({ error: 'Unknown action' }, 400)
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})
