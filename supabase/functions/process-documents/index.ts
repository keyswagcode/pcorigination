import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

console.log("=== FUNCTION STARTED (v10.0-claude-primary) ===");
console.log("[ENV CHECK] SUPABASE_URL:", Deno.env.get("SUPABASE_URL") ? "SET" : "MISSING");
console.log("[ENV CHECK] SUPABASE_SERVICE_ROLE_KEY:", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "SET" : "MISSING");
console.log("[ENV CHECK] ANTHROPIC_API_KEY:", Deno.env.get("ANTHROPIC_API_KEY") ? "SET" : "MISSING");
console.log("[ENV CHECK] OPEN_AI:", Deno.env.get("OPEN_AI") ? "SET (" + (Deno.env.get("OPEN_AI") || "").slice(0, 7) + "...)" : "MISSING");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
const openAiKey = Deno.env.get("OPEN_AI") || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ProcessingJob {
  id: string;
  document_id: string;
  intake_submission_id: string;
  document_type: string;
  status: string;
  retry_count: number;
  max_retries: number;
}

interface UploadedDoc {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  borrower_id: string;
  intake_submission_id: string;
  document_type: string;
}

interface ExtractionResult {
  bank_name: string;
  account_type: string;
  account_holder_name: string;
  statement_period_start: string;
  statement_period_end: string;
  opening_balance: number;
  closing_balance: number;
  available_cash: number;
  total_deposits: number;
  total_withdrawals: number;
  deposit_count: number;
  withdrawal_count: number;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are an expert financial analyst reviewing a bank statement.

Your job:
1. Identify the bank name, account holder, and statement period
2. Find the opening and closing balances
3. Identify ALL transactions — classify each as a deposit (credit/inflow) or withdrawal (debit/outflow/payment/purchase)
4. Sum all deposits and all withdrawals separately
5. Count deposits and withdrawals

CRITICAL RULES:
- Deposits are POSITIVE inflows: direct deposits, transfers in, credits, refunds
- Withdrawals are NEGATIVE outflows: payments, purchases, transfers out, debits, fees
- DO NOT return 0 for totals unless you are absolutely certain there are zero transactions
- If the text is messy or columns are misaligned, ESTIMATE based on visible dollar amounts
- available_cash equals closing_balance if not explicitly stated
- Set confidence 0.7-1.0 when you find clear balances and transactions, 0.3-0.6 for partial data

Return ONLY a valid JSON object with this exact structure — no explanation, no markdown:
{
  "bank_name": "string",
  "account_type": "checking or savings",
  "account_holder_name": "string",
  "statement_period_start": "YYYY-MM-DD",
  "statement_period_end": "YYYY-MM-DD",
  "opening_balance": number,
  "closing_balance": number,
  "available_cash": number,
  "total_deposits": number,
  "total_withdrawals": number,
  "deposit_count": number,
  "withdrawal_count": number,
  "confidence": number
}`;

function buildFallbackResult(): ExtractionResult {
  return {
    bank_name: "Unknown Bank",
    account_type: "checking",
    account_holder_name: "Unknown",
    statement_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    statement_period_end: new Date().toISOString().slice(0, 10),
    opening_balance: 0,
    closing_balance: 0,
    available_cash: 0,
    total_deposits: 0,
    total_withdrawals: 0,
    deposit_count: 0,
    withdrawal_count: 0,
    confidence: 0.1,
  };
}

function parseOpenAiContent(content: string, jobId: string): ExtractionResult {
  console.log(`[PARSE][${jobId}] Raw OpenAI content (first 800):`, content.slice(0, 800));
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);
    const result: ExtractionResult = {
      bank_name: parsed.bank_name || "Unknown Bank",
      account_type: parsed.account_type || "checking",
      account_holder_name: parsed.account_holder_name || "Unknown",
      statement_period_start: parsed.statement_period_start || buildFallbackResult().statement_period_start,
      statement_period_end: parsed.statement_period_end || buildFallbackResult().statement_period_end,
      opening_balance: Number(parsed.opening_balance) || 0,
      closing_balance: Number(parsed.closing_balance) || 0,
      available_cash: Number(parsed.available_cash) || Number(parsed.closing_balance) || 0,
      total_deposits: Number(parsed.total_deposits) || 0,
      total_withdrawals: Number(parsed.total_withdrawals) || 0,
      deposit_count: Number(parsed.deposit_count) || 0,
      withdrawal_count: Number(parsed.withdrawal_count) || 0,
      confidence: Number(parsed.confidence) || 0.5,
    };
    console.log(`[PARSE][${jobId}] SUCCESS:`, JSON.stringify(result));
    return result;
  } catch (e) {
    console.error(`[PARSE][${jobId}] JSON parse FAILED:`, e, "Content was:", content.slice(0, 500));
    return buildFallbackResult();
  }
}

// Encode in chunks — String.fromCharCode(...bytes) spreads the whole file as
// call arguments and throws "Maximum call stack size exceeded" on files over
// ~100KB (i.e. every phone photo). Seen in prod on IMG_5721.png.
function toBase64(fileBytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < fileBytes.length; i += CHUNK) {
    binary += String.fromCharCode(...fileBytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Primary extractor: Anthropic Messages API reads PDFs and images natively in
// a single call — no separate file-upload step to fail like OpenAI's Files API.
async function callClaude(
  fileBytes: Uint8Array,
  mimeType: string,
  fileName: string,
  jobId: string,
): Promise<ExtractionResult> {
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  console.log(`[CLAUDE][${jobId}] Sending ${isPdf ? "PDF" : mimeType} (${fileBytes.length} bytes) to claude-sonnet-5`);

  const base64Data = toBase64(fileBytes);
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
    : {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
        data: base64Data,
      },
    };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACTION_PROMPT }] }],
    }),
  });

  const resText = await res.text();
  console.log(`[CLAUDE][${jobId}] HTTP ${res.status}:`, resText.slice(0, 300));
  if (!res.ok) return buildFallbackResult();

  const data = JSON.parse(resText);
  const content = data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  if (!content) {
    console.error(`[CLAUDE][${jobId}] No text content in response`);
    return buildFallbackResult();
  }
  return parseOpenAiContent(content, jobId);
}

async function callOpenAiFileApi(
  fileBytes: Uint8Array,
  fileName: string,
  jobId: string,
): Promise<ExtractionResult> {
  console.log(`[FILE-API][${jobId}] Uploading PDF to OpenAI Files. Bytes: ${fileBytes.length}`);

  const formData = new FormData();
  formData.append("file", new File([fileBytes], fileName, { type: "application/pdf" }));
  formData.append("purpose", "assistants");

  const uploadRes = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: formData,
  });

  const uploadText = await uploadRes.text();
  console.log(`[FILE-API][${jobId}] Upload HTTP ${uploadRes.status}:`, uploadText.slice(0, 300));

  if (!uploadRes.ok) {
    console.error(`[FILE-API][${jobId}] File upload failed`);
    return buildFallbackResult();
  }

  const uploadData = JSON.parse(uploadText);
  const fileId: string = uploadData.id;
  console.log(`[FILE-API][${jobId}] Uploaded file_id: ${fileId}`);

  let result: ExtractionResult;
  try {
    const responsesRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                file_id: fileId,
              },
              {
                type: "input_text",
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
        temperature: 0.1,
        text: { format: { type: "json_object" } },
      }),
    });

    const responsesText = await responsesRes.text();
    console.log(`[FILE-API][${jobId}] Responses HTTP ${responsesRes.status}:`, responsesText.slice(0, 500));

    if (!responsesRes.ok) {
      console.error(`[FILE-API][${jobId}] Responses call failed`);
      result = buildFallbackResult();
    } else {
      const responsesData = JSON.parse(responsesText);
      const content = responsesData.output?.[0]?.content?.[0]?.text ?? "";
      console.log(`[FILE-API][${jobId}] Content sample:`, content.slice(0, 300));
      result = content ? parseOpenAiContent(content, jobId) : buildFallbackResult();
    }
  } finally {
    const delRes = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${openAiKey}` },
    });
    console.log(`[FILE-API][${jobId}] File delete HTTP ${delRes.status}`);
  }

  return result;
}

async function callOpenAiVision(
  fileBytes: Uint8Array,
  mimeType: string,
  jobId: string,
): Promise<ExtractionResult> {
  console.log(`[VISION][${jobId}] Sending image (${mimeType}) to gpt-4o-mini vision. Bytes: ${fileBytes.length}`);

  const base64Data = toBase64(fileBytes);
  const imageMediaType = mimeType.startsWith("image/") ? mimeType : "image/jpeg";

  const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMediaType};base64,${base64Data}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const chatText = await chatRes.text();
  console.log(`[VISION][${jobId}] HTTP ${chatRes.status}:`, chatText.slice(0, 500));

  if (!chatRes.ok) return buildFallbackResult();

  const chatData = JSON.parse(chatText);
  const content = chatData.choices?.[0]?.message?.content;
  if (!content) {
    console.error(`[VISION][${jobId}] No content in response`);
    return buildFallbackResult();
  }

  return parseOpenAiContent(content, jobId);
}

// Claude first, OpenAI as fallback. A provider "failed" when it errored or
// returned the low-confidence fallback shape — in that case the other provider
// gets a shot before we give up and route to manual review.
async function extractDocument(
  fileBytes: Uint8Array,
  mimeType: string,
  fileName: string,
  jobId: string,
): Promise<ExtractionResult> {
  if (!anthropicKey && !openAiKey) {
    console.error(`[EXTRACT][${jobId}] No AI provider configured (ANTHROPIC_API_KEY and OPEN_AI both empty)`);
    return buildFallbackResult();
  }

  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  console.log(`[EXTRACT][${jobId}] isPdf: ${isPdf}, mimeType: ${mimeType}, fileName: ${fileName}`);

  let result = buildFallbackResult();

  if (anthropicKey) {
    try {
      result = await callClaude(fileBytes, mimeType, fileName, jobId);
    } catch (err) {
      console.error(`[EXTRACT][${jobId}] Claude threw:`, err instanceof Error ? err.message : err);
    }
    if (result.confidence >= 0.3) return result;
    console.warn(`[EXTRACT][${jobId}] Claude result unusable (confidence ${result.confidence}) — trying OpenAI fallback`);
  }

  if (openAiKey) {
    try {
      const openAiResult = isPdf
        ? await callOpenAiFileApi(fileBytes, fileName, jobId)
        : await callOpenAiVision(fileBytes, mimeType, jobId);
      if (openAiResult.confidence > result.confidence) result = openAiResult;
    } catch (err) {
      console.error(`[EXTRACT][${jobId}] OpenAI threw:`, err instanceof Error ? err.message : err);
    }
  }

  return result;
}

// Email the borrower's AE when extraction couldn't read a statement and it
// lands in the manual-review queue. Runs server-side so the alert fires no
// matter which path triggered processing (the portal's client-side ping only
// covers the case where this whole function throws). Deduped to one email per
// borrower per hour via borrower_activity_log so multi-statement uploads
// don't spam.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function alertAeManualReview(doc: UploadedDoc, jobId: string): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey || !doc.borrower_id) return;

    const { data: borrower } = await supabase
      .from("borrowers")
      .select("id, borrower_name, email, broker_id")
      .eq("id", doc.borrower_id)
      .maybeSingle();
    if (!borrower?.broker_id) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentAlert } = await supabase
      .from("borrower_activity_log")
      .select("id")
      .eq("borrower_id", borrower.id)
      .eq("event_type", "manual_review_alert")
      .gte("created_at", oneHourAgo)
      .limit(1)
      .maybeSingle();
    if (recentAlert) {
      console.log(`[ALERT][${jobId}] AE already alerted within the hour — skipping`);
      return;
    }

    const { data: ae } = await supabase
      .from("user_accounts")
      .select("email, first_name")
      .eq("id", borrower.broker_id)
      .maybeSingle();
    if (!ae?.email) return;

    const name = esc(borrower.borrower_name || "A borrower");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Key Real Estate Capital <noreply@keyrealestatecapital.com>",
        to: [ae.email],
        subject: `Manual read needed: ${borrower.borrower_name || "borrower"}'s bank statement couldn't be read automatically`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
            <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 4px;">Manual read needed</h1>
            <p style="color:#0d9488;font-size:13px;margin:0 0 20px;">Loan Center · bank statement review queue</p>
            <p style="color:#333;font-size:15px;line-height:1.6;"><strong>${name}</strong>${borrower.email ? ` (${esc(borrower.email)})` : ""} uploaded a bank statement that automated extraction couldn't read (file: ${esc(doc.file_name)}). Please open the file, read the balances, and set liquidity so the pre-approval can go out.</p>
            <a href="https://pcorigination.vercel.app/internal/my-borrowers/${borrower.id}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open borrower file</a>
            <p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically when a statement enters the review queue.</p>
          </div>`,
      }),
    });
    console.log(`[ALERT][${jobId}] AE alert email → HTTP ${res.status}`);

    await supabase.from("borrower_activity_log").insert({
      borrower_id: borrower.id,
      event_type: "manual_review_alert",
      title: "AE alerted: statement needs manual read",
      details: `Automated extraction couldn't read ${doc.file_name}; emailed ${ae.email}`,
    });
  } catch (err) {
    // Alerting must never fail the job itself.
    console.error(`[ALERT][${jobId}] alert failed:`, err instanceof Error ? err.message : err);
  }
}

async function processDocument(
  job: ProcessingJob,
  doc: UploadedDoc,
): Promise<void> {
  console.log(`[JOB][${job.id}] Starting — file: ${doc.file_name}, path: ${doc.file_path}, type: ${doc.mime_type}`);

  await supabase
    .from("document_processing_jobs")
    .update({
      status: "extracting",
      started_at: new Date().toISOString(),
      extraction_started_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabase
    .from("uploaded_documents")
    .update({ processing_status: "processing" })
    .eq("id", doc.id);

  console.log(`[JOB][${job.id}] Downloading from storage path: ${doc.file_path}`);
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("borrower-documents")
    .download(doc.file_path);

  if (downloadError || !fileData) {
    console.error(`[JOB][${job.id}] DOWNLOAD FAILED:`, downloadError?.message);
    throw new Error(`Failed to download document: ${downloadError?.message}`);
  }

  const processingStartMs = Date.now();
  const fileBytes = new Uint8Array(await fileData.arrayBuffer());
  console.log(`[JOB][${job.id}] FILE SIZE: ${fileBytes.length} bytes`);

  if (fileBytes.length < 100) {
    console.error(`[JOB][${job.id}] FILE IS TOO SMALL (${fileBytes.length} bytes) — likely empty or download failed`);
    throw new Error(`File too small: ${fileBytes.length} bytes — likely an empty or corrupt file`);
  }

  const extracted = await extractDocument(fileBytes, doc.mime_type, doc.file_name, job.id);

  console.log(`[JOB][${job.id}] FINAL EXTRACTED: bank=${extracted.bank_name}, closing=${extracted.closing_balance}, deposits=${extracted.total_deposits}, confidence=${extracted.confidence}`);

  // When the model couldn't actually read the statement (low confidence, or a
  // $0/Unknown-Bank placeholder), flag it so the broker queue can tell
  // "verified $0" apart from "unreadable — needs human eyes."
  const needsReview =
    extracted.confidence < 0.5 ||
    !extracted.bank_name ||
    /unknown/i.test(extracted.bank_name) ||
    (Number(extracted.closing_balance) || 0) === 0;
  if (needsReview) {
    console.warn(`[JOB][${job.id}] Flagging needs_review (confidence ${extracted.confidence}, bank "${extracted.bank_name}")`);
    await alertAeManualReview(doc, job.id);
  }

  const { data: existingAccount } = await supabase
    .from("bank_statement_accounts")
    .select("id")
    .eq("document_id", doc.id)
    .maybeSingle();

  if (existingAccount) {
    console.warn(`[JOB][${job.id}] bank_statement_accounts row already exists for doc ${doc.id} — skipping duplicate insert`);
    await supabase
      .from("uploaded_documents")
      .update({ processing_status: "completed", extraction_status: "completed", is_processed: true })
      .eq("id", doc.id);
    await supabase
      .from("document_processing_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  const insertRow = {
    borrower_id: doc.borrower_id,
    document_id: doc.id,
    intake_submission_id: doc.intake_submission_id,
    bank_name: extracted.bank_name,
    account_type: extracted.account_type,
    account_holder_name: extracted.account_holder_name,
    statement_period_start: extracted.statement_period_start,
    statement_period_end: extracted.statement_period_end,
    opening_balance: extracted.opening_balance,
    closing_balance: extracted.closing_balance,
    available_cash: extracted.available_cash,
    total_deposits: extracted.total_deposits,
    total_withdrawals: extracted.total_withdrawals,
    deposit_count: extracted.deposit_count,
    withdrawal_count: extracted.withdrawal_count,
    extraction_confidence: extracted.confidence,
    needs_review: needsReview,
    extraction_version: "10.0-claude-primary",
    raw_extracted_data: {
      extraction_method: anthropicKey ? "claude_messages_api" : "openai_fallback",
      llm_extraction: extracted,
    },
  };

  console.log(`[JOB][${job.id}] Inserting bank_statement_accounts row...`);
  const { data: insertedAccount, error: accountError } = await supabase
    .from("bank_statement_accounts")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (accountError) {
    console.error(`[JOB][${job.id}] INSERT FAILED:`, JSON.stringify(accountError));
    throw new Error(`bank_statement_accounts insert failed: ${accountError.message} (code: ${accountError.code})`);
  }

  console.log(`[JOB][${job.id}] Inserted row id: ${insertedAccount?.id}`);

  await supabase
    .from("document_processing_jobs")
    .update({
      status: "completed",
      extraction_completed_at: new Date().toISOString(),
      extraction_confidence: extracted.confidence,
      completed_at: new Date().toISOString(),
      processing_duration_ms: Date.now() - processingStartMs,
      classified_type: "bank_statement",
      classification_confidence: extracted.confidence,
    })
    .eq("id", job.id);

  // classification_confidence lives on document_processing_jobs, NOT on
  // uploaded_documents — including it here made this update silently fail for
  // every document, stranding them all in "processing" (65 rows backfilled
  // 2026-07-02). Error is now checked so a schema drift can't hide again.
  const { error: docUpdateError } = await supabase
    .from("uploaded_documents")
    .update({
      processing_status: needsReview ? "needs_review" : "completed",
      extraction_status: "completed",
      is_processed: true,
    })
    .eq("id", doc.id);
  if (docUpdateError) {
    throw new Error(`final uploaded_documents update failed: ${docUpdateError.message}`);
  }

  console.log(`[JOB][${job.id}] COMPLETE in ${Date.now() - processingStartMs}ms`);
}

async function processSubmission(submissionId: string): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  console.log(`[SUBMISSION][${submissionId}] Starting processSubmission`);

  await supabase
    .from("document_processing_jobs")
    .update({ status: "queued" })
    .eq("intake_submission_id", submissionId)
    .in("status", ["ocr_processing", "extracting"]);

  await supabase
    .from("uploaded_documents")
    .update({ processing_status: "pending", is_processed: false })
    .eq("intake_submission_id", submissionId)
    .in("processing_status", ["processing", "failed"]);

  let { data: jobs } = await supabase
    .from("document_processing_jobs")
    .select("*")
    .eq("intake_submission_id", submissionId)
    .in("status", ["queued", "uploaded"])
    .order("created_at", { ascending: true });

  console.log(`[SUBMISSION][${submissionId}] Found ${jobs?.length ?? 0} queued jobs`);

  if (!jobs || jobs.length === 0) {
    const { data: pendingDocs } = await supabase
      .from("uploaded_documents")
      .select("id, document_type, intake_submission_id")
      .eq("intake_submission_id", submissionId)
      .in("processing_status", ["pending", "failed", "uploaded"]);

    console.log(`[SUBMISSION][${submissionId}] No jobs found — found ${pendingDocs?.length ?? 0} pending/failed docs`);

    if (!pendingDocs || pendingDocs.length === 0) {
      return { processed: 0, failed: 0, errors: ["No pending documents found for this submission"] };
    }

    const newJobs = pendingDocs.map((doc: { id: string; document_type: string; intake_submission_id: string }) => ({
      document_id: doc.id,
      intake_submission_id: doc.intake_submission_id,
      document_type: doc.document_type || "bank_statement",
      status: "queued",
      priority: 1,
      retry_count: 0,
      max_retries: 3,
    }));

    const { data: insertedJobs, error: insertError } = await supabase
      .from("document_processing_jobs")
      .insert(newJobs)
      .select("*");

    if (insertError || !insertedJobs || insertedJobs.length === 0) {
      console.error(`[SUBMISSION][${submissionId}] Failed to create jobs:`, insertError);
      return { processed: 0, failed: 0, errors: ["Failed to create processing jobs"] };
    }

    console.log(`[SUBMISSION][${submissionId}] Created ${insertedJobs.length} new jobs`);
    jobs = insertedJobs;
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process documents with bounded concurrency. Sequential OpenAI calls
  // (~3-10s each) meant 10+ documents could exceed the edge-function timeout
  // and strand the submission half-processed; 3-wide keeps memory sane while
  // cutting wall-clock ~3x.
  const CONCURRENCY = 3;
  const queue = [...jobs];

  const runOne = async (job: ProcessingJob) => {
    const { data: doc } = await supabase
      .from("uploaded_documents")
      .select("*")
      .eq("id", job.document_id)
      .maybeSingle();

    if (!doc) {
      console.error(`[JOB][${job.id}] Document ${job.document_id} not found`);
      errors.push(`Document ${job.document_id} not found`);
      failed++;
      return;
    }

    try {
      await processDocument(job, doc as UploadedDoc);
      processed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[JOB][${job.id}] THREW ERROR:`, message);
      errors.push(`${doc.file_name}: ${message}`);

      const newRetryCount = (job.retry_count || 0) + 1;
      const isFinalFailure = newRetryCount >= (job.max_retries || 3);

      await supabase
        .from("document_processing_jobs")
        .update({
          status: isFinalFailure ? "failed" : "queued",
          error_message: message,
          error_details: { error: message, attempt: newRetryCount },
          retry_count: newRetryCount,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (isFinalFailure) {
        // The statement itself is safely stored — a hard extraction failure
        // must land in the manual-review queue with the AE pinged, never in a
        // dead "failed" state nobody is watching.
        await supabase
          .from("uploaded_documents")
          .update({ processing_status: "needs_review", error_message: message })
          .eq("id", doc.id);
        await alertAeManualReview(doc as UploadedDoc, job.id);
      }

      failed++;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        await runOne(job as ProcessingJob);
      }
    }),
  );

  const { data: allJobs } = await supabase
    .from("document_processing_jobs")
    .select("status")
    .eq("intake_submission_id", submissionId);

  const allCompleted = allJobs?.every(
    (j: { status: string }) => j.status === "completed" || j.status === "failed",
  );

  if (allCompleted) {
    const anySuccess = allJobs?.some((j: { status: string }) => j.status === "completed");
    await supabase
      .from("intake_submissions")
      .update({
        processing_stage: anySuccess ? "documents_processed" : "documents_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
  }

  console.log(`[SUBMISSION][${submissionId}] Done — processed: ${processed}, failed: ${failed}`);
  return { processed, failed, errors };
}

Deno.serve(async (req: Request) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[REQUEST BODY]:", JSON.stringify(body));
    const { submission_id } = body;

    if (!submission_id) {
      return new Response(
        JSON.stringify({ error: "submission_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Require a real user JWT and verify the caller owns this submission (or is
    // staff). Previously the function ran on the public anon key alone, so
    // anyone could trigger OpenAI extraction on any submission_id.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData } = await supabase.auth.getUser(token);
    const caller = authData?.user;
    if (!caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: sub } = await supabase
      .from("intake_submissions")
      .select("id, user_id, borrower_id")
      .eq("id", submission_id)
      .maybeSingle();

    if (!sub) {
      return new Response(
        JSON.stringify({ error: "Submission not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let allowed = sub.user_id === caller.id;
    if (!allowed && sub.borrower_id) {
      const { data: b } = await supabase
        .from("borrowers")
        .select("user_id, broker_id")
        .eq("id", sub.borrower_id)
        .maybeSingle();
      allowed = b?.user_id === caller.id || b?.broker_id === caller.id;
    }
    if (!allowed) {
      const { data: acct } = await supabase
        .from("user_accounts")
        .select("user_role")
        .eq("id", caller.id)
        .maybeSingle();
      allowed = acct?.user_role === "admin" || acct?.user_role === "reviewer";
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await processSubmission(submission_id);
    console.log("[RESPONSE]:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[FATAL ERROR]:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
