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

      let plaidUserId = borrower.plaid_user_id

      if (!plaidUserId) {
        const { data: account } = await serviceClient
          .from('user_accounts')
          .select('first_name, last_name')
          .eq('id', user.id)
          .maybeSingle()

        const name = splitName(borrower.borrower_name, account?.first_name, account?.last_name)
        const ssnDigits = (borrower.ssn_encrypted || '').replace(/\D/g, '')

        const identity: Record<string, unknown> = { name }
        if (borrower.date_of_birth) identity.date_of_birth = borrower.date_of_birth
        if (borrower.email) identity.emails = [{ data: borrower.email, primary: true }]
        if (borrower.phone) {
          const phoneDigits = borrower.phone.replace(/\D/g, '')
          identity.phone_numbers = [{ data: `+1${phoneDigits}`, primary: true }]
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
        if (ssnDigits.length === 9) {
          identity.id_numbers = [{ type: 'us_ssn', value: ssnDigits }]
        } else if (ssnDigits.length === 4) {
          identity.id_numbers = [{ type: 'us_ssn_last_4', value: ssnDigits }]
        }

        const userData = await plaidRequest('/user/create', {
          client_user_id: user.id,
          identity,
        })
        plaidUserId = userData.user_id

        await serviceClient
          .from('borrowers')
          .update({ plaid_user_id: plaidUserId })
          .eq('id', borrower.id)
      }

      const tokenData = await plaidRequest('/link/token/create', {
        user: { user_id: plaidUserId },
        client_name: 'Key Real Estate Capital',
        products: ['cra_base_report'],
        consumer_report_permissible_purpose: 'CREDIT_PREQUALIFICATION',
        cra_options: { days_requested: 90 },
        country_codes: ['US'],
        language: 'en',
        webhook: PLAID_WEBHOOK_URL,
      })

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

    // Polling endpoint so the borrower UI can check report status
    if (action === 'get_report_status') {
      const { data: borrower } = await serviceClient
        .from('borrowers')
        .select('plaid_report_status')
        .eq('user_id', user.id)
        .maybeSingle()

      return new Response(JSON.stringify({
        status: borrower?.plaid_report_status || null,
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
