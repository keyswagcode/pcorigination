import { supabase } from './supabaseClient';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

interface ExtractionResult {
  bank_name: string;
  account_holder: string;
  statement_period: string;
  ending_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  average_balance: number;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are a bank statement data extraction expert. Extract financial data from bank statements accurately.
Always respond with valid JSON only, no markdown or extra text. Use this exact schema:
{
  "bank_name": "string",
  "account_holder": "string",
  "statement_period": "string (e.g. 'January 2026' or '01/01/2026 - 01/31/2026')",
  "ending_balance": number,
  "total_deposits": number,
  "total_withdrawals": number,
  "average_balance": number,
  "confidence": number (0.0 to 1.0, how confident you are in the extraction)
}
If you cannot determine a value, use 0 for numbers and "Unknown" for strings. Set confidence lower if data is unclear.`;

async function extractViaFileUpload(fileData: Blob, fileName: string): Promise<ExtractionResult> {
  // Step 1: Upload file to OpenAI
  const formData = new FormData();
  formData.append('file', fileData, fileName);
  formData.append('purpose', 'assistants');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload failed: ${uploadRes.status}`);
  }

  const uploadResult = await uploadRes.json();
  const fileId = uploadResult.id;

  // Step 2: Use responses API with the uploaded file
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: EXTRACTION_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              file_id: fileId,
            },
            {
              type: 'input_text',
              text: 'Extract the financial data from this bank statement. Return only the JSON object.',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    // Fallback to chat completions with image approach
    throw new Error(`Responses API failed: ${response.status}`);
  }

  const result = await response.json();
  const content = result.output?.[0]?.content?.[0]?.text || '';

  // Clean up the uploaded file
  fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
  }).catch(() => {});

  return parseExtractionResponse(content);
}

async function extractViaVision(fileData: Blob): Promise<ExtractionResult> {
  const arrayBuffer = await fileData.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the financial data from this bank statement. Return only the JSON object.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vision API failed: ${response.status} - ${err}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || '';
  return parseExtractionResponse(content);
}

function parseExtractionResponse(content: string): ExtractionResult {
  if (!content) throw new Error('Empty response from AI');

  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse AI response: ${jsonStr.slice(0, 200)}`);
  }
}

export async function extractBankStatement(filePath: string): Promise<ExtractionResult> {
  // Download the file from Supabase storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('borrower-documents')
    .download(filePath);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download: ${downloadError?.message || 'no data'}`);
  }

  const isPdf = filePath.toLowerCase().endsWith('.pdf');
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(filePath);

  // Try extraction methods in order of preference
  const errors: string[] = [];

  // For PDFs: try file upload API first
  if (isPdf) {
    try {
      return await extractViaFileUpload(fileData, filePath.split('/').pop() || 'document.pdf');
    } catch (err) {
      errors.push(`File API: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // For images or as PDF fallback: try vision API
  if (isImage) {
    try {
      return await extractViaVision(fileData);
    } catch (err) {
      errors.push(`Vision API: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Final fallback for PDFs: convert to base64 and try chat with text description
  if (isPdf) {
    try {
      const arrayBuffer = await fileData.arrayBuffer();
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = textDecoder.decode(arrayBuffer);

      // Extract readable text from the PDF (basic text extraction)
      const textMatches = rawText.match(/\(([^)]+)\)/g);
      const extractedText = textMatches
        ? textMatches.map(m => m.slice(1, -1)).join(' ').slice(0, 3000)
        : rawText.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);

      if (extractedText.trim().length < 20) {
        throw new Error('Could not extract readable text from PDF');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: `Extract the financial data from this bank statement text:\n\n${extractedText}` },
          ],
          max_tokens: 1000,
          temperature: 0,
        }),
      });

      if (!response.ok) throw new Error(`Chat API: ${response.status}`);

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content?.trim() || '';
      return parseExtractionResponse(content);
    } catch (err) {
      errors.push(`Text fallback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All extraction methods failed: ${errors.join('; ')}`);
}

export async function verifyLiquidityFromStatements(
  borrowerId: string,
  filePaths: string[]
): Promise<{ totalLiquidity: number; extractions: ExtractionResult[] }> {
  const extractions: ExtractionResult[] = [];
  let totalLiquidity = 0;

  for (const filePath of filePaths) {
    try {
      const result = await extractBankStatement(filePath);
      extractions.push(result);
      totalLiquidity += result.ending_balance;
    } catch (err) {
      console.error(`Failed to extract ${filePath}:`, err);
    }
  }

  if (extractions.length === 0) {
    throw new Error('Could not extract data from any uploaded bank statements. Please ensure you upload clear PDF or image files of your bank statements.');
  }

  const avgConfidence = extractions.reduce((sum, e) => sum + e.confidence, 0) / extractions.length;

  // Update borrower financial profile
  await supabase.from('borrower_financial_profiles').upsert({
    borrower_id: borrowerId,
    liquidity_estimate: totalLiquidity,
    ending_balance_avg: totalLiquidity / extractions.length,
    avg_monthly_deposits: extractions.reduce((sum, e) => sum + e.total_deposits, 0) / extractions.length,
    confidence_score: Math.round(avgConfidence * 100),
    summary: {
      source: 'ai_extraction',
      extractions: extractions.map(e => ({
        bank: e.bank_name,
        holder: e.account_holder,
        period: e.statement_period,
        ending_balance: e.ending_balance,
        deposits: e.total_deposits,
        withdrawals: e.total_withdrawals,
      })),
      total_liquidity: totalLiquidity,
      verified_at: new Date().toISOString(),
    },
  }, { onConflict: 'borrower_id' });

  // Update borrower lifecycle
  await supabase.from('borrowers')
    .update({ lifecycle_stage: 'liquidity_verified' })
    .eq('id', borrowerId);

  // Generate pre-approvals
  const dscrAmount = totalLiquidity * 4;
  const fixFlipAmount = totalLiquidity * 10;
  const bridgeAmount = totalLiquidity * 5;

  // Delete old pre-approvals first
  await supabase.from('pre_approvals')
    .delete()
    .eq('borrower_id', borrowerId);

  await supabase.from('pre_approvals').insert([
    {
      borrower_id: borrowerId,
      loan_type: 'dscr',
      status: 'approved',
      sub_status: 'pre_approved',
      prequalified_amount: dscrAmount,
      qualification_max: dscrAmount,
      verified_liquidity: totalLiquidity,
      passes_liquidity_check: true,
      summary: `DSCR Loan Pre-Approval: Up to $${dscrAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (4x multiplier)`,
      machine_decision: 'approved',
      machine_confidence: Math.round(avgConfidence * 100),
    },
    {
      borrower_id: borrowerId,
      loan_type: 'fix_flip',
      status: 'approved',
      sub_status: 'pre_approved',
      prequalified_amount: fixFlipAmount,
      qualification_max: fixFlipAmount,
      verified_liquidity: totalLiquidity,
      passes_liquidity_check: true,
      summary: `Fix & Flip Pre-Approval: Up to $${fixFlipAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (10x multiplier)`,
      machine_decision: 'approved',
      machine_confidence: Math.round(avgConfidence * 100),
    },
    {
      borrower_id: borrowerId,
      loan_type: 'bridge',
      status: 'approved',
      sub_status: 'pre_approved',
      prequalified_amount: bridgeAmount,
      qualification_max: bridgeAmount,
      verified_liquidity: totalLiquidity,
      passes_liquidity_check: true,
      summary: `Bridge Loan Pre-Approval: Up to $${bridgeAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (5x multiplier)`,
      machine_decision: 'approved',
      machine_confidence: Math.round(avgConfidence * 100),
    },
  ]);

  // Update borrower status to prequalified
  await supabase.from('borrowers')
    .update({ lifecycle_stage: 'pre_approved', borrower_status: 'prequalified' })
    .eq('id', borrowerId);

  return { totalLiquidity, extractions };
}
