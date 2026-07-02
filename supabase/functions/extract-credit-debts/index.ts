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
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
    const openAiKey = Deno.env.get('OPEN_AI') || ''
    if (!anthropicKey && !openAiKey) throw new Error('No AI provider configured')

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

    const PROMPT = `This is a consumer credit report. Extract the borrower's TOTAL MONTHLY DEBT PAYMENTS from the open tradelines (look for a TRADE SUMMARY or totals row showing combined monthly payments; otherwise sum the monthly payment of each OPEN tradeline — mortgages, auto loans, student loans, credit-card minimums, personal loans. Exclude closed/paid accounts and collections without payments). Respond with ONLY this JSON: {"total_monthly_debt": <number>, "open_tradelines": <count>, "confidence": <0-1>}`

    const parseResult = (text: string): { debt: number; tradelines: number } | null => {
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return null
      try {
        const parsed = JSON.parse(m[0])
        if (typeof parsed.total_monthly_debt === 'number' && parsed.total_monthly_debt >= 0 && (parsed.confidence ?? 1) >= 0.4) {
          return { debt: Math.round(parsed.total_monthly_debt), tradelines: parsed.open_tradelines || 0 }
        }
      } catch { /* fall through */ }
      return null
    }

    let monthlyDebt: number | null = null
    let tradelineCount = 0

    // Primary: Claude reads the PDF natively in one call.
    if (anthropicKey) {
      try {
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        const rsp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(binary) } },
                { type: 'text', text: PROMPT },
              ],
            }],
          }),
        })
        if (rsp.ok) {
          const out = await rsp.json()
          const text = (out.content || []).filter((c: { type: string }) => c.type === 'text')
            .map((c: { text?: string }) => c.text || '').join('')
          const r = parseResult(text)
          if (r) { monthlyDebt = r.debt; tradelineCount = r.tradelines }
        } else {
          console.error('Claude extraction failed:', rsp.status, (await rsp.text()).slice(0, 200))
        }
      } catch (err) {
        console.error('Claude extraction threw:', (err as Error).message)
      }
    }

    // Fallback: OpenAI Files + Responses API (same pattern as process-documents).
    if (monthlyDebt == null && openAiKey) {
      const form = new FormData()
      form.append('file', new File([bytes], doc.file_name || 'credit_report.pdf', { type: 'application/pdf' }))
      form.append('purpose', 'assistants')
      const up = await fetch('https://api.openai.com/v1/files', {
        method: 'POST', headers: { Authorization: `Bearer ${openAiKey}` }, body: form,
      })
      if (up.ok) {
        const fileMeta = await up.json()
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
                  { type: 'input_text', text: PROMPT },
                ],
              }],
            }),
          })
          if (rsp.ok) {
            const out = await rsp.json()
            const text = (out.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || [])
              .map((c: { text?: string }) => c.text || '').join('')
            const r = parseResult(text)
            if (r) { monthlyDebt = r.debt; tradelineCount = r.tradelines }
          }
        } finally {
          await fetch(`https://api.openai.com/v1/files/${fileMeta.id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${openAiKey}` },
          }).catch(() => {})
        }
      } else {
        console.error('OpenAI file upload failed:', up.status, (await up.text()).slice(0, 200))
      }
    }

    // Both providers failed → flag the document and ping the AE for a manual read.
    if (monthlyDebt == null) {
      await serviceClient.from('uploaded_documents')
        .update({ processing_status: 'needs_review' })
        .eq('id', doc.id)

      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey && bb?.broker_id) {
        const { data: ae } = await serviceClient.from('user_accounts').select('email').eq('id', bb.broker_id).maybeSingle()
        const { data: bInfo } = await serviceClient.from('borrowers').select('borrower_name, email').eq('id', doc.borrower_id).maybeSingle()
        if (ae?.email) {
          const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const name = esc(bInfo?.borrower_name || 'A borrower')
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Key Real Estate Capital <noreply@keyrealestatecapital.com>',
              to: [ae.email],
              subject: `Manual read needed: ${bInfo?.borrower_name || 'borrower'}'s credit report couldn't be read automatically`,
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
                  <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 4px;">Manual read needed</h1>
                  <p style="color:#0d9488;font-size:13px;margin:0 0 20px;">Loan Center · credit report review</p>
                  <p style="color:#333;font-size:15px;line-height:1.6;"><strong>${name}</strong>${bInfo?.email ? ` (${esc(bInfo.email)})` : ''} has a credit report (${esc(doc.file_name || 'credit report')}) that automated extraction couldn't read. Please open it, total the monthly debt payments, and enter them so the DTI and Primary Residence pre-approval can be calculated.</p>
                  <a href="https://pcorigination.vercel.app/internal/my-borrowers/${doc.borrower_id}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open borrower file</a>
                  <p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically when a credit report can't be read.</p>
                </div>`,
            }),
          }).catch(() => { /* alert is best-effort */ })
        }
      }

      return new Response(JSON.stringify({ ok: false, reason: 'could not extract debts from this report — AE notified for manual read' }), {
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
