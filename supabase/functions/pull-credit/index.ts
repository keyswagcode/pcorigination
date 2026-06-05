import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APIFY_TOKEN = Deno.env.get('APIFY_TOKEN') || ''
const APIFY_ACTOR_ID = Deno.env.get('APIFY_ACTOR_ID') || ''

// Optional outbound proxy for the Apify Actor — set these so every credit
// pull egresses from the same static IP and ISC can whitelist it (skipping
// MFA). When unset, the actor runs without a proxy and MFA is required.
const ISC_PROXY_HOST = Deno.env.get('ISC_PROXY_HOST') || ''
const ISC_PROXY_PORT = Deno.env.get('ISC_PROXY_PORT') || ''
const ISC_PROXY_USER = Deno.env.get('ISC_PROXY_USER') || ''
const ISC_PROXY_PASS = Deno.env.get('ISC_PROXY_PASS') || ''

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
  // Headed Chromium (headless:false + xvfb) needs ~4GB or the platform OOM-kills
  // the run, which surfaces to us as status=ABORTED with no OUTPUT.error — the
  // exact symptom of the 2026-05-15 failure. Pin memory, give the run enough
  // wall-clock for login + up-to-5-min MFA wait + order + payment + PDF, and
  // always run the newest build so a fresh `apify push` takes effect.
  const params = new URLSearchParams({ memory: '4096', timeout: '900', build: 'latest' })
  const data = await apifyJson<{ data: ApifyRun }>(
    `/acts/${encodeURIComponent(APIFY_ACTOR_ID)}/runs?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return data.data
}

async function getRun(runId: string): Promise<ApifyRun> {
  const data = await apifyJson<{ data: ApifyRun }>(`/actor-runs/${runId}`)
  return data.data
}

async function getKvRecord(storeId: string, key: string): Promise<Response> {
  return await apifyFetch(`/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`)
}

// Apify only populates `containerUrl` for actors that use Standby mode or
// explicitly expose an HTTP port. For headed-browser actors we fall back to
// the Apify console URL — the broker has to be logged into apify.com in the
// same browser, then the console's "Live View" tab streams the running
// container so they can type the SMS code.
async function waitForLiveView(runId: string, timeoutMs = 10_000): Promise<{ run: ApifyRun; liveViewUrl: string | null }> {
  const start = Date.now()
  let run = await getRun(runId)
  while (Date.now() - start < timeoutMs) {
    if (run.containerUrl) return { run, liveViewUrl: run.containerUrl }
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) return { run, liveViewUrl: null }
    await new Promise((r) => setTimeout(r, 1500))
    run = await getRun(runId)
  }
  // Fall back to the console URL: console.apify.com/actors/<id>/runs/<runId>
  // The console UI has a "Live View" tab that streams the headed browser via VNC.
  const consoleUrl = `https://console.apify.com/actors/${encodeURIComponent(APIFY_ACTOR_ID)}/runs/${runId}`
  return { run, liveViewUrl: consoleUrl }
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

    // ----- save_card_metadata: persist last4 + non-sensitive bits after a successful pull
    // We never store the full PAN or CVC.
    if (action === 'save_card_metadata') {
      const { last4, brand, holderName, zip, expMonth, expYear } = body
      if (!last4 || String(last4).replace(/\D/g, '').length !== 4) {
        return jsonRes({ error: 'last4 must be exactly 4 digits' }, 400)
      }
      const { error } = await serviceClient
        .from('user_accounts')
        .update({
          saved_card_last4: String(last4).replace(/\D/g, ''),
          saved_card_brand: brand || null,
          saved_card_holder_name: holderName || null,
          saved_card_zip: zip ? String(zip).replace(/\D/g, '').slice(0, 5) : null,
          saved_card_exp_month: expMonth ? String(expMonth).replace(/\D/g, '').padStart(2, '0').slice(-2) : null,
          saved_card_exp_year: expYear ? String(expYear).replace(/\D/g, '') : null,
          saved_card_updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
      if (error) throw error
      return jsonRes({ ok: true })
    }

    // ----- forget_card: clear saved card metadata -----
    if (action === 'forget_card') {
      const { error } = await serviceClient
        .from('user_accounts')
        .update({
          saved_card_last4: null,
          saved_card_brand: null,
          saved_card_holder_name: null,
          saved_card_zip: null,
          saved_card_exp_month: null,
          saved_card_exp_year: null,
          saved_card_updated_at: null,
        })
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
        .select('isc_username, isc_password_encrypted, isc_session_state')
        .eq('id', user.id)
        .maybeSingle()
      if (!brokerRow?.isc_username || !brokerRow?.isc_password_encrypted) {
        return jsonRes({ error: 'No ISC credentials saved. Add them in Settings before pulling credit.' }, 400)
      }

      const [firstName, ...rest] = (borrower.borrower_name || '').split(/\s+/)
      const lastName = rest.join(' ') || ''

      const proxyConfig = ISC_PROXY_HOST && ISC_PROXY_PORT
        ? {
            server: `http://${ISC_PROXY_HOST}:${ISC_PROXY_PORT}`,
            username: ISC_PROXY_USER || undefined,
            password: ISC_PROXY_PASS || undefined,
          }
        : undefined

      const run = await startActorRun({
        iscUsername: brokerRow.isc_username,
        iscPassword: brokerRow.isc_password_encrypted,
        sessionState: brokerRow.isc_session_state || undefined,
        proxy: proxyConfig,
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

    // ----- submit_mfa_code: write the SMS code into the running actor's KV store -----
    if (action === 'submit_mfa_code') {
      const { runId, code } = body
      if (!runId || !code) return jsonRes({ error: 'Missing runId or code' }, 400)
      const cleanCode = String(code).replace(/\D/g, '')
      if (cleanCode.length < 4 || cleanCode.length > 10) {
        return jsonRes({ error: 'Code must be 4-10 digits' }, 400)
      }
      const run = await getRun(runId)
      // PUT the code into the actor's default key-value store; the actor's
      // poll loop picks it up within 2 seconds.
      const putRes = await fetch(
        `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/mfa_code.txt?token=${APIFY_TOKEN}`,
        { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: cleanCode }
      )
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '')
        throw new Error(`Failed to write MFA code: ${putRes.status} ${text.slice(0, 200)}`)
      }
      return jsonRes({ ok: true })
    }

    // ----- pull_status: called by frontend on a poll loop -----
    if (action === 'pull_status') {
      const { runId, borrower_id } = body
      if (!runId || !borrower_id) return jsonRes({ error: 'Missing runId or borrower_id' }, 400)

      const run = await getRun(runId)
      if (run.status === 'READY' || run.status === 'RUNNING') {
        // Check if the actor is waiting on an SMS code from us
        let mfaRequired = false
        try {
          const mfaRes = await getKvRecord(run.defaultKeyValueStoreId, 'mfa_status.json')
          const mfaStatus = await mfaRes.json() as { state?: string }
          mfaRequired = mfaStatus?.state === 'awaiting_code'
        } catch { /* mfa_status.json not present yet */ }
        return jsonRes({ ok: true, status: 'pending', liveViewUrl: run.containerUrl || null, mfaRequired })
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
        monthly_debt?: number | null
        pdfKey?: string | null
        error?: string
      }
      if (!output.ok) {
        return jsonRes({ ok: false, status: 'failed', error: output.error || 'Actor returned ok=false' })
      }

      // Persist captured session state so the next pull can skip login + MFA.
      // Best-effort — if it's not present (e.g., older actor build), skip silently.
      try {
        const sessionRes = await getKvRecord(run.defaultKeyValueStoreId, 'session_state.json')
        const session = await sessionRes.json()
        if (session?.cookies) {
          await serviceClient
            .from('user_accounts')
            .update({
              isc_session_state: session,
              isc_session_captured_at: new Date().toISOString(),
            })
            .eq('id', user.id)
        }
      } catch { /* session_state.json not present in this run */ }

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
        .select('summary, monthly_income')
        .eq('borrower_id', borrower_id)
        .maybeSingle()
      const prevSummary = (existingProfile?.summary as Record<string, unknown> | null) || {}

      // Back-end DTI = total monthly debt (from this credit report) / monthly
      // income (from bank statements, if already on file) * 100.
      const monthlyDebt = typeof output.monthly_debt === 'number' ? output.monthly_debt : null
      const monthlyIncome = Number((existingProfile as { monthly_income?: number } | null)?.monthly_income) || 0
      const dti = (monthlyDebt != null && monthlyIncome > 0)
        ? Math.round((monthlyDebt / monthlyIncome) * 1000) / 10
        : null

      const profileUpdate: Record<string, unknown> = {
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
            monthly_debt: monthlyDebt,
            document_id: documentId,
          },
        },
      }
      if (monthlyDebt != null) profileUpdate.monthly_debt = monthlyDebt
      if (dti != null) { profileUpdate.dti = dti; profileUpdate.dti_computed_at = new Date().toISOString() }
      await serviceClient.from('borrower_financial_profiles').upsert(profileUpdate, { onConflict: 'borrower_id' })

      if (mid) {
        await serviceClient.from('borrowers').update({ credit_score: mid }).eq('id', borrower_id)
      }

      await serviceClient.from('borrower_activity_log').insert({
        borrower_id, user_id: user.id, event_type: 'credit_pulled',
        title: 'Credit pulled from ISC',
        details: `EQ ${output.scores?.equifax ?? '—'} · EX ${output.scores?.experian ?? '—'} · TU ${output.scores?.transunion ?? '—'} · mid ${mid ?? '—'}`
          + (monthlyDebt != null ? ` · Debt $${monthlyDebt}/mo` : '')
          + (dti != null ? ` · DTI ${dti}%` : ''),
      })

      return jsonRes({
        ok: true,
        status: 'succeeded',
        monthly_debt: monthlyDebt,
        dti,
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
