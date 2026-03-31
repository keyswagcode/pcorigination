import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

console.log("=== FUNCTION STARTED (v9.0-openai-files) ===");
console.log("[ENV CHECK] SUPABASE_URL:", Deno.env.get("SUPABASE_URL") ? "SET" : "MISSING");
console.log("[ENV CHECK] SUPABASE_SERVICE_ROLE_KEY:", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "SET" : "MISSING");
console.log("[ENV CHECK] OPEN_AI:", Deno.env.get("OPEN_AI") ? "SET (" + (Deno.env.get("OPEN_AI") || "").slice(0, 7) + "...)" : "MISSING");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  const base64Data = btoa(String.fromCharCode(...fileBytes));
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

async function extractDocument(
  fileBytes: Uint8Array,
  mimeType: string,
  fileName: string,
  jobId: string,
): Promise<ExtractionResult> {
  if (!openAiKey) {
    console.error(`[EXTRACT][${jobId}] OPEN_AI env var is EMPTY — cannot call OpenAI`);
    return buildFallbackResult();
  }

  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  console.log(`[EXTRACT][${jobId}] isPdf: ${isPdf}, mimeType: ${mimeType}, fileName: ${fileName}`);

  if (isPdf) {
    console.log(`[EXTRACT][${jobId}] PDF path: uploading to OpenAI Files API`);
    return await callOpenAiFileApi(fileBytes, fileName, jobId);
  } else {
    console.log(`[EXTRACT][${jobId}] Image path: sending to OpenAI vision`);
    return await callOpenAiVision(fileBytes, mimeType, jobId);
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

  if (extracted.confidence < 0.2) {
    console.warn(`[JOB][${job.id}] Extraction confidence low (${extracted.confidence}) — inserting with low_confidence flag`);
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
    extraction_version: "9.0-openai-files",
    raw_extracted_data: {
      extraction_method: doc.mime_type === "application/pdf" ? "openai_files_api" : "openai_vision",
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

  await supabase
    .from("uploaded_documents")
    .update({
      processing_status: "completed",
      extraction_status: "completed",
      classification_confidence: extracted.confidence,
      is_processed: true,
    })
    .eq("id", doc.id);

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

  for (const job of jobs) {
    const { data: doc } = await supabase
      .from("uploaded_documents")
      .select("*")
      .eq("id", job.document_id)
      .maybeSingle();

    if (!doc) {
      console.error(`[JOB][${job.id}] Document ${job.document_id} not found`);
      errors.push(`Document ${job.document_id} not found`);
      failed++;
      continue;
    }

    try {
      await processDocument(job as ProcessingJob, doc as UploadedDoc);
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
        await supabase
          .from("uploaded_documents")
          .update({ processing_status: "failed", error_message: message })
          .eq("id", doc.id);
      }

      failed++;
    }
  }

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
