import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALORA_ENDPOINT = Deno.env.get('VALORA_ENDPOINT') || ''

interface BorrowerForOrder {
  borrower_name: string | null
  email: string | null
  phone: string | null
}

interface LoanForOrder {
  id: string
  scenario_name: string | null
  loan_type: string | null
  loan_purpose: string | null
  property_address: string | null
  property_city: string | null
  property_state: string | null
  property_zip: string | null
  property_type: string | null
  purchase_price: number | null
  estimated_value: number | null
  loan_amount: number | null
  rehab_budget: number | null
  after_repair_value: number | null
  refinance_type: string | null
}

interface OrderPayload {
  // What we'd POST to Valora once we have their docs.
  product_code: string
  is_purchase: boolean
  needs_arv: boolean
  needs_subject_to_repairs: boolean
  borrower: BorrowerForOrder
  loan: LoanForOrder
  broker_username: string
}

/** Pick the appraisal product based on loan type + purpose. Once Valora's
 * actual product codes are known these strings will be replaced with their
 * exact identifiers (e.g. "URAR_1004", "1025_2-4_UNIT", etc.). */
function classifyAppraisal(loan: LoanForOrder): { productCode: string; needsArv: boolean; needsSubjectToRepairs: boolean } {
  const type = (loan.loan_type || '').toLowerCase()
  const propType = (loan.property_type || '').toLowerCase()
  const isMulti = propType.includes('2-4') || propType.includes('multi')

  // Default form for SFR depository / DSCR / Bridge / Bank Statement
  let productCode = isMulti ? 'multifamily_2_4_unit_1025' : 'sfr_1004'

  if (type === 'fix_flip') {
    productCode = isMulti ? 'multifamily_2_4_unit_1025_as_is_arv' : 'sfr_1004_as_is_arv'
    return { productCode, needsArv: true, needsSubjectToRepairs: true }
  }
  if (type === 'ground_up' || type === 'gu' || type === 'construction') {
    productCode = 'ground_up_construction_as_completed'
    return { productCode, needsArv: true, needsSubjectToRepairs: true }
  }
  // DSCR / Bridge / Bank Statement default to as-is appraisal
  return { productCode, needsArv: false, needsSubjectToRepairs: false }
}

async function callValoraApi(_payload: OrderPayload): Promise<{ orderId: string | null; rawResponse?: string }> {
  // TODO: actual Valora AMC API call. Pending Valora's documentation.
  // Once we have endpoint + auth shape, build the request body from
  // _payload (which already has every field we'd need) and POST it.
  // Until then this throws a clear error so a real order is never silently
  // dropped on the floor.
  if (!VALORA_ENDPOINT) {
    throw new Error('Valora integration is not configured yet. Set VALORA_ENDPOINT and complete callValoraApi().')
  }
  throw new Error('Valora API integration not yet implemented — pending Valora documentation.')
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
      const { error } = await serviceClient
        .from('user_accounts')
        .update({ valora_username: username, valora_password_encrypted: password })
        .eq('id', user.id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'clear_credentials') {
      const { error } = await serviceClient
        .from('user_accounts')
        .update({ valora_username: null, valora_password_encrypted: null })
        .eq('id', user.id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'preview') {
      // Returns a classified payload so the broker can see what we'd send to
      // Valora before actually sending it. No external call.
      const { loan_id } = body
      if (!loan_id) {
        return new Response(JSON.stringify({ error: 'Missing loan_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: loan } = await serviceClient
        .from('loan_scenarios')
        .select('id, scenario_name, loan_type, loan_purpose, property_address, property_city, property_state, property_zip, property_type, purchase_price, estimated_value, loan_amount, rehab_budget, after_repair_value, refinance_type, borrower_id')
        .eq('id', loan_id)
        .maybeSingle()
      if (!loan) throw new Error('Loan not found')
      const classification = classifyAppraisal(loan as LoanForOrder)
      return new Response(JSON.stringify({ ok: true, classification }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'order') {
      const { loan_id } = body
      if (!loan_id) {
        return new Response(JSON.stringify({ error: 'Missing loan_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: loan } = await serviceClient
        .from('loan_scenarios')
        .select('id, scenario_name, loan_type, loan_purpose, property_address, property_city, property_state, property_zip, property_type, purchase_price, estimated_value, loan_amount, rehab_budget, after_repair_value, refinance_type, borrower_id')
        .eq('id', loan_id)
        .maybeSingle()
      if (!loan) throw new Error('Loan not found')

      const { data: borrower } = await serviceClient
        .from('borrowers')
        .select('borrower_name, email, phone, broker_id')
        .eq('id', loan.borrower_id)
        .maybeSingle()
      if (!borrower) throw new Error('Borrower not found')

      const { data: brokerRow } = await serviceClient
        .from('user_accounts')
        .select('valora_username, valora_password_encrypted')
        .eq('id', user.id)
        .maybeSingle()
      if (!brokerRow?.valora_username || !brokerRow?.valora_password_encrypted) {
        return new Response(JSON.stringify({ error: 'No Valora credentials saved. Add them in Settings before ordering an appraisal.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const classification = classifyAppraisal(loan as LoanForOrder)

      const payload: OrderPayload = {
        product_code: classification.productCode,
        is_purchase: loan.loan_purpose !== 'refinance',
        needs_arv: classification.needsArv,
        needs_subject_to_repairs: classification.needsSubjectToRepairs,
        borrower: {
          borrower_name: borrower.borrower_name,
          email: borrower.email,
          phone: borrower.phone,
        },
        loan: loan as LoanForOrder,
        broker_username: brokerRow.valora_username,
      }

      try {
        const result = await callValoraApi(payload)
        await serviceClient.from('borrower_activity_log').insert({
          borrower_id: loan.borrower_id,
          user_id: user.id,
          event_type: 'appraisal_ordered',
          title: 'Appraisal ordered (Valora)',
          details: `Loan ${loan.scenario_name || loan.id} · product ${classification.productCode}${result.orderId ? ` · order ${result.orderId}` : ''}`,
        })
        return new Response(JSON.stringify({
          ok: true,
          order_id: result.orderId,
          classification,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      } catch (err) {
        const msg = (err as Error).message.slice(0, 500)
        await serviceClient.from('borrower_activity_log').insert({
          borrower_id: loan.borrower_id,
          user_id: user.id,
          event_type: 'appraisal_order_failed',
          title: 'Appraisal order failed',
          details: msg,
        })
        return new Response(JSON.stringify({ ok: false, error: msg, classification }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
