import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APIFY_TOKEN = Deno.env.get('APIFY_TOKEN') || ''
const APIFY_ACTOR_ID = Deno.env.get('APIFY_ACTOR_ID') || ''

// ---------- Apify helpers ----------

async function apifyFetch(path: string, init: RequestInit = {}) {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not set in edge function env')
  const url = `https://api.apify.com/v2${path}${path.includes('?') ? '&' : '?'}token=${APIFY_TOKEN}`
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Apify ${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return res
}

async function apifyJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apifyFetch(path, init)
  return await res.json() as T
}

interface ApifyRun {
  id: string
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMING-OUT' | 'TIMED-OUT' | 'ABORTING' | 'ABORTED'
  defaultKeyValueStoreId: string
  containerUrl?: string
}

async function startActorRun(input: Record<string, unknown>): Promise<ApifyRun> {
  if (!APIFY_ACTOR_ID) throw new Error('APIFY_ACTOR_ID not set')
  const data = await apifyJson<{ data: ApifyRun }>(`/acts/${encodeURIComponent(APIFY_ACTOR_ID)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.data
}

async function getRun(runId: string): Promise<ApifyRun> {
  const data = await apifyJson<{ data: ApifyRun }>(`/actor-runs/${runId}`)
  return data.data
}

async function getKvRecord(storeId: string, key: string): Promise<Response> {
  return await apifyFetch(`/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`)
}

// Apify exposes `containerUrl` (the live view) once the container starts.
async function waitForLiveView(runId: string, timeoutMs = 60_000): Promise<{ run: ApifyRun; liveViewUrl: string | null }> {
  const start = Date.now()
  let run = await getRun(runId)
  while (Date.now() - start < timeoutMs) {
    if (run.containerUrl) return { run, liveViewUrl: run.containerUrl }
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) return { run, liveViewUrl: null }
    await new Promise((r) => setTimeout(r, 2000))
    run = await getRun(runId)
  }
  return { run, liveViewUrl: null }
}

// ---------- request handler ----------

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonRes({ error: 'No authorization header' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token)
    if (authError || !user) return jsonRes({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const { action } = body

    // ----- save_credentials: store the broker's ISC username + password -----
    if (action === 'save_credentials') {
      const { username, password } = body
      if (!username || !password) return jsonRes({ error: 'Missing username or password' }, 400)
      const { error } = await serviceClient
        .from('user_accounts')
        .update({ isc_username: username, isc_password_encrypted: password })
        .eq('id', user.id)
      if (error) throw error
      return jsonRes({ ok: true })
    }

    // ----- clear_credentials -----
    if (action === 'clear_credentials') {
      const { error } = await serviceClient
        .from('user_accounts')
        .update({ isc_username: null, isc_password_encrypted: null })
        .eq('id', user.id)
      if (error) throw error
      return jsonRes({ ok: true })
    }

    // ----- pull_start: kick off the Apify run, return runId + live-view URL -----
    if (action === 'pull_start') {
      const { borrower_id, card } = body
      if (!borrower_id) return jsonRes({ error: 'Missing borrower_id' }, 400)
      if (!card?.number || !card?.expMonth || !card?.expYear || !card?.cvc || !card?.zip) {
        return jsonRes({ error: 'Card payment info is required for each pull. ISC bills the card directly; we do not store it.' }, 400)
      }

      const sanitizedCard = String(card.number).replace(/\D/g, '')
      if (sanitizedCard.length < 13 || sanitizedCard.length > 19) {
        return jsonRes({ error: 'Card number looks invalid.' }, 400)
      }

      const { data: borrower } = await serviceClient
        .from('borrowers')
        .select('id, borrower_name, email, phone, date_of_birth, ssn_encrypted, address_street, address_city, address_state, address_zip, credit_consent')
        .eq('id', borrower_id)
        .maybeSingle()
      if (!borrower) return jsonRes({ error: 'Borrower not found' }, 404)
      if (!borrower.credit_consent) return jsonRes({ error: 'Borrower has not given credit consent.' }, 400)

      const { data: brokerRow } = await serviceClient
        .from('user_accounts')
        .select('isc_username, isc_password_encrypted')
        .eq('id', user.id)
        .maybeSingle()
      if (!brokerRow?.isc_username || !brokerRow?.isc_password_encrypted) {
        return jsonRes({ error: 'No ISC credentials saved. Add them in Settings before pulling credit.' }, 400)
      }

      const [firstName, ...rest] = (borrower.borrower_name || '').split(/\s+/)
      const lastName = rest.join(' ') || ''

      const run = await startActorRun({
        iscUsername: brokerRow.isc_username,
        iscPassword: brokerRow.isc_password_encrypted,
        borrower: {
          firstName,
          lastName,
          ssn: borrower.ssn_encrypted, // column name is misleading — stored plaintext
          dob: borrower.date_of_birth,
          phone: borrower.phone,
          email: borrower.email,
          addressStreet: borrower.address_street,
          addressCity: borrower.address_city,
          addressState: borrower.address_state,
          addressZip: borrower.address_zip,
        },
        card: {
          number: sanitizedCard,
          expMonth: String(card.expMonth).replace(/\D/g, '').padStart(2, '0').slice(-2),
          expYear: String(card.expYear).replace(/\D/g, ''),
          cvc: String(card.cvc).replace(/\D/g, ''),
          zip: String(card.zip).replace(/\D/g, '').slice(0, 5),
          name: card.name ? String(card.name).slice(0, 100) : undefined,
        },
      })

      // Wait briefly for the live-view URL so the frontend can show it in case MFA is needed
      const { liveViewUrl } = await waitForLiveView(run.id)
      return jsonRes({ ok: true, runId: run.id, liveViewUrl })
    }

    // ----- pull_status: called by frontend on a poll loop -----
    if (action === 'pull_status') {
      const { runId, borrower_id } = body
      if (!runId || !borrower_id) return jsonRes({ error: 'Missing runId or borrower_id' }, 400)

      const run = await getRun(runId)
      if (run.status === 'READY' || run.status === 'RUNNING') {
        return jsonRes({ ok: true, status: 'pending', liveViewUrl: run.containerUrl || null })
      }
      if (run.status !== 'SUCCEEDED') {
        // Fetch error details from OUTPUT if present
        let errMsg = `Apify run ${run.status}`
        try {
          const outRes = await getKvRecord(run.defaultKeyValueStoreId, 'OUTPUT')
          const out = await outRes.json() as { error?: string }
          if (out?.error) errMsg = out.error
        } catch { /* no OUTPUT yet */ }
        await serviceClient.from('borrower_activity_log').insert({
          borrower_id, user_id: user.id, event_type: 'credit_pull_failed',
          title: 'Credit pull failed', details: errMsg.slice(0, 500),
        })
        return jsonRes({ ok: false, status: 'failed', error: errMsg })
      }

      // SUCCEEDED — read OUTPUT, store PDF, persist scores
      const outputRes = await getKvRecord(run.defaultKeyValueStoreId, 'OUTPUT')
      const output = await outputRes.json() as {
        ok: boolean
        scores?: { equifax: number | null; experian: number | null; transunion: number | null }
        pdfKey?: string | null
        error?: string
      }
      if (!output.ok) {
        return jsonRes({ ok: false, status: 'failed', error: output.error || 'Actor returned ok=false' })
      }

      let documentId: string | null = null
      if (output.pdfKey) {
        const pdfRes = await getKvRecord(run.defaultKeyValueStoreId, output.pdfKey)
        const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const fileName = `credit_report_${ts}.pdf`
        const filePath = `${borrower_id}/credit_report/${fileName}`
        const { error: uploadError } = await serviceClient.storage
          .from('borrower-documents')
          .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: false })
        if (uploadError) throw uploadError

        const { data: docRow, error: insertError } = await serviceClient
          .from('uploaded_documents')
          .insert({
            borrower_id,
            document_type: 'credit_report',
            document_subtype: 'isc_meridianlink',
            file_name: fileName,
            file_path: filePath,
            processing_status: 'uploaded',
          })
          .select('id')
          .maybeSingle()
        if (insertError) throw insertError
        documentId = docRow?.id || null
      }

      const mid = midOfThree([output.scores?.equifax, output.scores?.experian, output.scores?.transunion])
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
            source: 'isc_meridianlink',
            pulled_at: new Date().toISOString(),
            pulled_by_user_id: user.id,
            equifax: output.scores?.equifax ?? null,
            experian: output.scores?.experian ?? null,
            transunion: output.scores?.transunion ?? null,
            mid_score: mid,
            document_id: documentId,
          },
        },
      }, { onConflict: 'borrower_id' })

      if (mid) {
        await serviceClient.from('borrowers').update({ credit_score: mid }).eq('id', borrower_id)
      }

      await serviceClient.from('borrower_activity_log').insert({
        borrower_id, user_id: user.id, event_type: 'credit_pulled',
        title: 'Credit pulled from ISC',
        details: `EQ ${output.scores?.equifax ?? '—'} · EX ${output.scores?.experian ?? '—'} · TU ${output.scores?.transunion ?? '—'} · mid ${mid ?? '—'}`,
      })

      return jsonRes({
        ok: true,
        status: 'succeeded',
        equifax: output.scores?.equifax ?? null,
        experian: output.scores?.experian ?? null,
        transunion: output.scores?.transunion ?? null,
        mid_score: mid,
        document_id: documentId,
      })
    }

    return jsonRes({ error: 'Unknown action' }, 400)
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500)
  }
})

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function midOfThree(scores: (number | null | undefined)[]): number | null {
  const valid = scores.filter((s): s is number => typeof s === 'number' && s > 0).sort((a, b) => a - b)
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]
  if (valid.length === 2) return valid[0]
  return valid[1]
}
