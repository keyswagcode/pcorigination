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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, ...params } = await req.json()

    // CREATE LINK TOKEN - for initializing Plaid Link in the frontend
    if (action === 'create_link_token') {
      const data = await plaidRequest('/link/token/create', {
        user: { client_user_id: user.id },
        client_name: 'PC Origination',
        products: ['auth', 'transactions'],
        country_codes: ['US'],
        language: 'en',
      })

      return new Response(JSON.stringify({ link_token: data.link_token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // EXCHANGE PUBLIC TOKEN - after user completes Plaid Link
    if (action === 'exchange_token') {
      const { public_token, borrower_id } = params

      // Exchange for access token
      const exchangeData = await plaidRequest('/item/public_token/exchange', {
        public_token,
      })

      const accessToken = exchangeData.access_token

      // Get account balances
      const balanceData = await plaidRequest('/accounts/balance/get', {
        access_token: accessToken,
      })

      // Calculate total liquidity from all accounts
      let totalLiquidity = 0
      const accountSummaries: Array<{
        name: string
        type: string
        balance: number
        institution: string
      }> = []

      for (const account of balanceData.accounts || []) {
        const balance = account.balances?.current || account.balances?.available || 0
        // Only count depository accounts (checking, savings)
        if (account.type === 'depository') {
          totalLiquidity += balance
          accountSummaries.push({
            name: account.name,
            type: account.subtype || account.type,
            balance,
            institution: balanceData.item?.institution_id || 'Unknown',
          })
        }
      }

      // Store verified liquidity in borrower_financial_profiles
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      await serviceClient.from('borrower_financial_profiles').upsert({
        borrower_id,
        liquidity_estimate: totalLiquidity,
        ending_balance_avg: totalLiquidity,
        confidence_score: 95, // High confidence from Plaid
        summary: {
          source: 'plaid',
          accounts: accountSummaries,
          verified_at: new Date().toISOString(),
          total_liquidity: totalLiquidity,
        },
      }, { onConflict: 'borrower_id' })

      // Update borrower lifecycle stage
      await serviceClient.from('borrowers')
        .update({ lifecycle_stage: 'liquidity_verified' })
        .eq('id', borrower_id)

      return new Response(JSON.stringify({
        total_liquidity: totalLiquidity,
        accounts: accountSummaries,
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
