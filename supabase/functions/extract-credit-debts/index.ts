import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Reads an uploaded credit-report PDF, extracts the total monthly debt
// payments (tradelines), writes monthly_debt (+ DTI when income is known) to
// the borrower's financial profile, and — when both income and debt are
// present — generates/refreshes the DTI-based Primary Residence pre-approval
// via fn_upsert_primary_preapproval. Complements the automated ISC pull,
// covering reports that arrive as PDFs (e.g. the borrower's $65 self-pull).

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const openAiKey = Deno.env.get('OPEN_AI') || ''
    if (!openAiKey) throw new Error('OPEN_AI not configured')

    // Caller must be an authenticated user who manages the borrower (broker/
    // staff upload path) — verified against the document's borrower below.
    const authHeader = req.headers.get('Authorization') || ''
    const { data: { user } } = await serviceClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { document_id } = await req.json().catch(() => ({}))
    if (!document_id) {
      return new Response(JSON.stringify({ error: 'document_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: doc } = await serviceClient
      .from('uploaded_documents')
      .select('id, borrower_id, file_path, file_name, mime_type')
      .eq('id', document_id)
      .maybeSingle()
    if (!doc?.borrower_id) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Authorization: staff, or manager of this borrower, or the borrower.
    const { data: allowed } = await serviceClient.rpc('fn_caller_manages_borrower', { p_borrower_id: doc.borrower_id })
    const { data: b } = await serviceClient.from('borrowers').select('user_id').eq('id', doc.borrower_id).maybeSingle()
    const { data: acct } = await serviceClient.from('user_accounts').select('user_role').eq('id', user.id).maybeSingle()
    const isStaff = acct?.user_role === 'admin' || acct?.user_role === 'reviewer'
    // fn_caller_manages_borrower uses auth.uid() which is null under service —
    // check the useful conditions directly instead.
    const { data: bb } = await serviceClient.from('borrowers').select('broker_id').eq('id', doc.borrower_id).maybeSingle()
    void allowed
    if (!isStaff && bb?.broker_id !== user.id && b?.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Download the PDF.
    const { data: fileData, error: dlErr } = await serviceClient.storage
      .from('borrower-documents')
      .download(doc.file_path)
    if (dlErr || !fileData) throw new Error(`download failed: ${dlErr?.message || 'no data'}`)
    const bytes = new Uint8Array(await fileData.arrayBuffer())

    // Upload to OpenAI Files API, then extract with the Responses API
    // (same pattern as process-documents' callOpenAiFileApi).
    const form = new FormData()
    form.append('file', new File([bytes], doc.file_name || 'credit_report.pdf', { type: 'application/pdf' }))
    form.append('purpose', 'assistants')
    const up = await fetch('https://api.openai.com/v1/files', {
      method: 'POST', headers: { Authorization: `Bearer ${openAiKey}` }, body: form,
    })
    if (!up.ok) throw new Error(`OpenAI file upload failed: ${up.status} ${(await up.text()).slice(0, 150)}`)
    const fileMeta = await up.json()

    let monthlyDebt: number | null = null
    let tradelineCount = 0
    try {
      const rsp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          input: [{
            role: 'user',
            content: [
              { type: 'input_file', file_id: fileMeta.id },
              { type: 'input_text', text: `This is a consumer credit report. Extract the borrower's TOTAL MONTHLY DEBT PAYMENTS from the open tradelines (look for a TRADE SUMMARY or totals row showing combined monthly payments; otherwise sum the monthly payment of each OPEN tradeline — mortgages, auto loans, student loans, credit-card minimums, personal loans. Exclude closed/paid accounts and collections without payments). Respond with ONLY this JSON: {"total_monthly_debt": <number>, "open_tradelines": <count>, "confidence": <0-1>}` },
            ],
          }],
        }),
      })
      if (!rsp.ok) throw new Error(`Responses API ${rsp.status}`)
      const out = await rsp.json()
      const text = (out.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || [])
        .map((c: { text?: string }) => c.text || '').join('')
      const m = text.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0])
        if (typeof parsed.total_monthly_debt === 'number' && parsed.total_monthly_debt >= 0 && (parsed.confidence ?? 1) >= 0.4) {
          monthlyDebt = Math.round(parsed.total_monthly_debt)
          tradelineCount = parsed.open_tradelines || 0
        }
      }
    } finally {
      await fetch(`https://api.openai.com/v1/files/${fileMeta.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${openAiKey}` },
      }).catch(() => {})
    }

    if (monthlyDebt == null) {
      return new Response(JSON.stringify({ ok: false, reason: 'could not extract debts from this report' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Write monthly_debt (+ recompute DTI when income is known).
    const { data: prof } = await serviceClient
      .from('borrower_financial_profiles')
      .select('monthly_income')
      .eq('borrower_id', doc.borrower_id)
      .maybeSingle()
    const income = Number(prof?.monthly_income) || 0
    const dti = income > 0 ? Math.round((monthlyDebt / income) * 1000) / 10 : null

    await serviceClient.from('borrower_financial_profiles').upsert({
      borrower_id: doc.borrower_id,
      monthly_debt: monthlyDebt,
      ...(dti != null ? { dti, dti_computed_at: new Date().toISOString() } : {}),
    }, { onConflict: 'borrower_id' })

    // Primary Residence pre-approval when both sides are present.
    const { data: pa } = await serviceClient.rpc('fn_upsert_primary_preapproval', { p_borrower_id: doc.borrower_id })

    return new Response(JSON.stringify({
      ok: true, monthly_debt: monthlyDebt, tradelines: tradelineCount, dti, primary_preapproval: pa,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message.slice(0, 200) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
