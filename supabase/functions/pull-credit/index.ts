import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ISC_ENDPOINT = Deno.env.get('ISC_CREDIT_ENDPOINT') || ''

interface CreditPullResult {
  ok: boolean
  equifax: number | null
  experian: number | null
  transunion: number | null
  mid_score: number | null
  raw_xml?: string
}

function midOfThree(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => typeof s === 'number' && s > 0).sort((a, b) => a - b)
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]
  if (valid.length === 2) return valid[0]
  return valid[1]
}

interface BorrowerForPull {
  borrower_name: string | null
  date_of_birth: string | null
  ssn_encrypted: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  credit_consent: boolean | null
}

async function callIscApi(_params: {
  username: string
  password: string
  borrower: BorrowerForPull
}): Promise<CreditPullResult> {
  // TODO: ISC Credit Bureau API call.
  // Once we have ISC's developer documentation (or a working sample request),
  // build the MISMO/XML request body here, POST to ISC_ENDPOINT with the
  // broker's username/password, parse the XML response, and pull out the three
  // bureau scores. Until then this throws so we never silently store fake data.
  if (!ISC_ENDPOINT) {
    throw new Error('ISC integration is not configured yet. Set ISC_CREDIT_ENDPOINT and complete callIscApi().')
  }
  throw new Error('ISC API integration not yet implemented — pending ISC documentation.')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { action } = body

    if (action === 'save_credentials') {
      const { username, password } = body
      if (!username || !password) {
        return new Response(JSON.stringify({ error: 'Missing username or password' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { error: updateError } = await serviceClient
        .from('user_accounts')
        .update({ isc_username: username, isc_password_encrypted: password })
        .eq('id', user.id)
      if (updateError) throw updateError
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'clear_credentials') {
      const { error: updateError } = await serviceClient
        .from('user_accounts')
        .update({ isc_username: null, isc_password_encrypted: null })
        .eq('id', user.id)
      if (updateError) throw updateError
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'pull') {
      const { borrower_id } = body
      if (!borrower_id) {
        return new Response(JSON.stringify({ error: 'Missing borrower_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: borrower, error: borrowerError } = await serviceClient
        .from('borrowers')
        .select('id, borrower_name, date_of_birth, ssn_encrypted, address_street, address_city, address_state, address_zip, credit_consent')
        .eq('id', borrower_id)
        .maybeSingle()
      if (borrowerError) throw borrowerError
      if (!borrower) throw new Error('Borrower not found')
      if (!borrower.credit_consent) {
        return new Response(JSON.stringify({ error: 'Borrower has not given credit consent.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: brokerRow } = await serviceClient
        .from('user_accounts')
        .select('isc_username, isc_password_encrypted')
        .eq('id', user.id)
        .maybeSingle()
      if (!brokerRow?.isc_username || !brokerRow?.isc_password_encrypted) {
        return new Response(JSON.stringify({ error: 'No ISC credentials saved. Add them in Settings before pulling credit.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let result: CreditPullResult
      try {
        result = await callIscApi({
          username: brokerRow.isc_username,
          password: brokerRow.isc_password_encrypted,
          borrower: borrower as BorrowerForPull,
        })
      } catch (err) {
        await serviceClient.from('borrower_activity_log').insert({
          borrower_id,
          user_id: user.id,
          event_type: 'credit_pull_failed',
          title: 'Credit pull failed',
          details: (err as Error).message.slice(0, 500),
        })
        throw err
      }

      // Persist parsed scores
      const mid = midOfThree([result.equifax, result.experian, result.transunion])

      // Read existing summary so we can merge instead of overwriting Plaid data
      const { data: existingProfile } = await serviceClient
        .from('borrower_financial_profiles')
        .select('summary')
        .eq('borrower_id', borrower_id)
        .maybeSingle()
      const prevSummary = (existingProfile?.summary as Record<string, unknown> | null) || {}

      await serviceClient.from('borrower_financial_profiles').upsert({
        borrower_id,
        summary: {
          ...prevSummary,
          credit_report: {
            source: 'isc_credit_bureau',
            pulled_at: new Date().toISOString(),
            pulled_by_user_id: user.id,
            equifax: result.equifax,
            experian: result.experian,
            transunion: result.transunion,
            mid_score: mid,
          },
        },
      }, { onConflict: 'borrower_id' })

      if (mid) {
        await serviceClient
          .from('borrowers')
          .update({ credit_score: mid })
          .eq('id', borrower_id)
      }

      await serviceClient.from('borrower_activity_log').insert({
        borrower_id,
        user_id: user.id,
        event_type: 'credit_pulled',
        title: 'Credit pulled from ISC',
        details: `EQ ${result.equifax ?? '—'} · EX ${result.experian ?? '—'} · TU ${result.transunion ?? '—'} · mid ${mid ?? '—'}`,
      })

      return new Response(JSON.stringify({
        ok: true,
        equifax: result.equifax,
        experian: result.experian,
        transunion: result.transunion,
        mid_score: mid,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
