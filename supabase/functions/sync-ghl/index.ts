import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GHL_API = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

async function ghlRequest(method: string, path: string, body?: Record<string, unknown>) {
  const apiKey = Deno.env.get('GHL_API_KEY')
  if (!apiKey) throw new Error('GHL_API_KEY not configured')

  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': GHL_VERSION,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: Record<string, unknown> | null = null
  try { data = text ? JSON.parse(text) : null } catch { /* keep null */ }
  return { ok: res.ok, status: res.status, data, raw: text }
}

interface GhlUser { id?: string; email?: string }
interface GhlUsersResponse { users?: GhlUser[] }

async function findGhlUserIdByEmail(locationId: string, email: string): Promise<string | null> {
  if (!email) return null
  const { ok, data } = await ghlRequest('GET', `/users/?locationId=${encodeURIComponent(locationId)}`)
  if (!ok || !data) return null
  const list = (data as GhlUsersResponse).users || []
  for (const u of list) {
    if (u.email && u.email.toLowerCase() === email.toLowerCase() && u.id) return u.id
  }
  return null
}

interface UpsertParams {
  locationId: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  address: { street?: string | null; city?: string | null; state?: string | null; postalCode?: string | null }
  assignedTo: string | null
  tags: string[]
}

interface UpsertResult { contactId: string | null; created: boolean; error?: string }

async function upsertContact(params: UpsertParams): Promise<UpsertResult> {
  const body: Record<string, unknown> = {
    locationId: params.locationId,
    email: params.email,
    firstName: params.firstName || undefined,
    lastName: params.lastName || undefined,
    name: [params.firstName, params.lastName].filter(Boolean).join(' ') || undefined,
    phone: params.phone || undefined,
    address1: params.address.street || undefined,
    city: params.address.city || undefined,
    state: params.address.state || undefined,
    postalCode: params.address.postalCode || undefined,
    tags: params.tags.length > 0 ? params.tags : undefined,
  }
  if (params.assignedTo) body.assignedTo = params.assignedTo

  // v2 upsert handles both create and update via single endpoint.
  const upsert = await ghlRequest('POST', '/contacts/upsert', body)
  if (upsert.ok && upsert.data) {
    const data = upsert.data as Record<string, unknown>
    const contact = (data.contact as Record<string, unknown> | undefined) || data
    const id = (contact?.id as string | undefined) || (data.contactId as string | undefined) || null
    const newRecord = (data.new as boolean | undefined) ?? true
    return { contactId: id, created: !!newRecord }
  }

  return {
    contactId: null,
    created: false,
    error: `GHL upsert ${upsert.status}: ${upsert.raw.slice(0, 300)}`,
  }
}

async function addTags(contactId: string, tags: string[]): Promise<void> {
  await ghlRequest('POST', `/contacts/${contactId}/tags`, { tags })
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

    const locationId = Deno.env.get('GHL_LOCATION_ID') || ''
    if (!locationId) {
      return new Response(JSON.stringify({ error: 'GHL_LOCATION_ID not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, borrower_id } = await req.json()
    if (!borrower_id) {
      return new Response(JSON.stringify({ error: 'Missing borrower_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tagForAction: Record<string, string> = {
      borrower_filled_app: 'Filled out App',
      borrower_pre_approved: 'Pre-Approved',
      borrower_doc_uploaded: 'Docs Uploaded',
    }
    const tag = tagForAction[action]
    if (!tag) {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: borrower } = await serviceClient
      .from('borrowers')
      .select('id, borrower_name, email, phone, broker_id, address_street, address_city, address_state, address_zip')
      .eq('id', borrower_id)
      .maybeSingle()
    if (!borrower) throw new Error('Borrower not found')
    if (!borrower.email) {
      return new Response(JSON.stringify({ ok: false, error: 'Borrower has no email; cannot sync to GHL' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let brokerEmail: string | null = null
    if (borrower.broker_id) {
      const { data: broker } = await serviceClient
        .from('user_accounts')
        .select('email')
        .eq('id', borrower.broker_id)
        .maybeSingle()
      brokerEmail = broker?.email || null
    }

    const ghlUserId = brokerEmail ? await findGhlUserIdByEmail(locationId, brokerEmail) : null

    const nameParts = (borrower.borrower_name || '').trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''

    const phoneDigits = (borrower.phone || '').replace(/\D/g, '')
    const phoneE164 = phoneDigits.length === 10
      ? `+1${phoneDigits}`
      : phoneDigits.length === 11 && phoneDigits.startsWith('1') ? `+${phoneDigits}` : null

    try {
      const upsert = await upsertContact({
        locationId,
        email: borrower.email,
        firstName,
        lastName,
        phone: phoneE164,
        address: {
          street: borrower.address_street,
          city: borrower.address_city,
          state: borrower.address_state,
          postalCode: borrower.address_zip,
        },
        assignedTo: ghlUserId,
        tags: [tag],
      })

      if (!upsert.contactId) throw new Error(upsert.error || 'GHL upsert returned no contact id')

      // Belt-and-suspenders: also call the tags endpoint so existing contacts
      // pick up the tag even if the upsert request didn't apply it.
      await addTags(upsert.contactId, [tag])

      await serviceClient.from('borrower_activity_log').insert({
        borrower_id,
        user_id: user.id,
        event_type: 'ghl_synced',
        title: 'Synced to GoHighLevel',
        details: `Contact ${upsert.contactId} · ${upsert.created ? 'created' : 'updated'} · tag: ${tag}${ghlUserId ? ` · assignedTo broker user ${ghlUserId}` : ' · no broker user match'}`,
      })

      return new Response(JSON.stringify({
        ok: true,
        contact_id: upsert.contactId,
        created: upsert.created,
        assigned: !!ghlUserId,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500)
      console.error('GHL sync failed:', msg)
      await serviceClient.from('borrower_activity_log').insert({
        borrower_id,
        user_id: user.id,
        event_type: 'ghl_sync_failed',
        title: 'GoHighLevel sync failed',
        details: msg,
      })
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
