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
  // Qualifying income for this statement period: the recurring income portion
  // of deposits (payroll, business revenue, recurring client payments, etc.),
  // EXCLUDING transfers between the borrower's own accounts, credit-card/loan
  // proceeds, refunds/reversals, and one-time atypical lump sums.
  qualifying_income: number;
  months_in_period: number; // how many months this statement covers (usually 1)
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
  "qualifying_income": number,
  "months_in_period": number,
  "confidence": number (0.0 to 1.0, how confident you are in the extraction)
}
Guidance:
- "total_deposits" = ALL credits/deposits in the period.
- "qualifying_income" = only the RECURRING INCOME portion of those deposits: payroll,
  direct deposits, business revenue, and recurring client/customer payments. EXCLUDE
  transfers between the account holder's own accounts, credit-card or loan proceeds,
  refunds/reversals/chargebacks, and one-time atypical lump sums (e.g. a gift, asset
  sale, or tax refund). When unsure whether a deposit is income, exclude it.
- "months_in_period" = number of months the statement covers (normally 1; use 2/3 for
  multi-month statements).
If you cannot determine a value, use 0 for numbers and "Unknown" for strings. Set confidence lower if data is unclear.`;

function toBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(buf =>
    btoa(new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), ''))
  );
}

/** PDFs: use OpenAI Responses API with inline base64 file */
async function extractPdf(fileData: Blob, fileName: string): Promise<ExtractionResult> {
  const base64 = await toBase64(fileData);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
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
              filename: fileName,
              file_data: `data:application/pdf;base64,${base64}`,
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
    const errBody = await response.text();
    console.error('Responses API error:', response.status, errBody);
    throw new Error(`Responses API failed: ${response.status} - ${errBody.slice(0, 200)}`);
  }

  const result = await response.json();
  const content = result.output?.[0]?.content?.[0]?.text
    || result.output?.find((o: any) => o.type === 'message')?.content?.[0]?.text
    || '';

  return parseExtractionResponse(content);
}

/** Images: use Chat Completions vision API */
async function extractImage(fileData: Blob): Promise<ExtractionResult> {
  const base64 = await toBase64(fileData);
  const mimeType = fileData.type || 'image/png';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the financial data from this bank statement. Return only the JSON object.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vision API failed: ${response.status} - ${err.slice(0, 200)}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || '';
  return parseExtractionResponse(content);
}

function parseExtractionResponse(content: string): ExtractionResult {
  if (!content) throw new Error('Empty response from AI');

  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse AI response: ${jsonStr.slice(0, 200)}`);
  }
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : 'Unknown');
  return {
    bank_name: str(raw.bank_name),
    account_holder: str(raw.account_holder),
    statement_period: str(raw.statement_period),
    ending_balance: num(raw.ending_balance),
    total_deposits: num(raw.total_deposits),
    total_withdrawals: num(raw.total_withdrawals),
    average_balance: num(raw.average_balance),
    qualifying_income: num(raw.qualifying_income),
    months_in_period: num(raw.months_in_period) || 1,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
  };
}

export async function extractBankStatement(filePath: string): Promise<ExtractionResult> {
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('borrower-documents')
    .download(filePath);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download: ${downloadError?.message || 'no data'}`);
  }

  const isPdf = filePath.toLowerCase().endsWith('.pdf');

  try {
    if (isPdf) {
      return await extractPdf(fileData, filePath.split('/').pop() || 'document.pdf');
    } else {
      return await extractImage(fileData);
    }
  } catch (err) {
    console.error(`Extraction failed for ${filePath}:`, err);
    throw err;
  }
}

// Recompute back-end DTI from the borrower's financial profile:
//   DTI% = monthly_debt (from credit report) / monthly_income (bank statements) * 100
// Safe to call after either input changes; writes dti + dti_computed_at and
// returns the new DTI percent (or null if income is unknown).
export async function recomputeDti(borrowerId: string): Promise<number | null> {
  const { data: profile } = await supabase
    .from('borrower_financial_profiles')
    .select('monthly_income, monthly_debt')
    .eq('borrower_id', borrowerId)
    .maybeSingle();

  const income = Number(profile?.monthly_income) || 0;
  const debt = Number(profile?.monthly_debt) || 0;
  if (income <= 0) return null; // can't compute DTI without income

  const dti = Math.round((debt / income) * 1000) / 10; // percent, 1 decimal
  await supabase
    .from('borrower_financial_profiles')
    .update({ dti, dti_computed_at: new Date().toISOString() })
    .eq('borrower_id', borrowerId);
  return dti;
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

  // Income from however many statement-months we have, using the qualifying
  // (recurring income) portion of deposits. A statement may cover >1 month, so
  // divide total qualifying income by the total months covered.
  const totalMonths = extractions.reduce((s, e) => s + (e.months_in_period || 1), 0) || extractions.length;
  const totalQualifyingIncome = extractions.reduce((s, e) => s + (e.qualifying_income || 0), 0);
  const monthlyIncome = totalMonths > 0 ? Math.round(totalQualifyingIncome / totalMonths) : 0;
  const annualIncome = monthlyIncome * 12;

  // Update borrower financial profile
  await supabase.from('borrower_financial_profiles').upsert({
    borrower_id: borrowerId,
    liquidity_estimate: totalLiquidity,
    ending_balance_avg: totalLiquidity / extractions.length,
    avg_monthly_deposits: extractions.reduce((sum, e) => sum + e.total_deposits, 0) / extractions.length,
    monthly_income: monthlyIncome,
    income_estimate: annualIncome,
    income_method: 'bank_statements_qualifying',
    income_months: totalMonths,
    confidence_score: Math.round(avgConfidence * 100),
    summary: {
      source: 'ai_extraction',
      income_method: 'bank_statements_qualifying',
      months_covered: totalMonths,
      monthly_income: monthlyIncome,
      extractions: extractions.map(e => ({
        bank: e.bank_name,
        holder: e.account_holder,
        period: e.statement_period,
        ending_balance: e.ending_balance,
        deposits: e.total_deposits,
        qualifying_income: e.qualifying_income,
        withdrawals: e.total_withdrawals,
      })),
      total_liquidity: totalLiquidity,
      verified_at: new Date().toISOString(),
    },
  }, { onConflict: 'borrower_id' });

  // Recompute back-end DTI now that income changed (uses monthly debt from a
  // prior credit pull if present).
  await recomputeDti(borrowerId);

  // Update borrower lifecycle
  await supabase.from('borrowers')
    .update({ lifecycle_stage: 'liquidity_verified' })
    .eq('id', borrowerId);

  // Citizenship-aware pre-approval terms. Non-US citizens get stricter rules:
  //   • All loan types capped at 3x verified liquidity (vs 4x DSCR / 5x bridge /
  //     10x fix & flip for US citizens).
  //   • 35% down payment / 65% max LTV on every loan type (carried as a
  //     condition here; enforced against LTV in run-preapproval).
  //   • $100k minimum loan amount — still issued if under, but flagged for
  //     manual review (passes_liquidity_check=false + a condition).
  const { data: borrowerRow } = await supabase
    .from('borrowers')
    .select('foreign_national')
    .eq('id', borrowerId)
    .maybeSingle();
  const isForeignNational = !!borrowerRow?.foreign_national;
  const NON_CITIZEN_MIN_LOAN = 100000;

  const usCitizenMultiplier: Record<string, number> = { dscr: 4, fix_flip: 10, bridge: 5 };

  const buildPreApproval = (loanType: 'dscr' | 'fix_flip' | 'bridge', label: string) => {
    const multiplier = isForeignNational ? 3 : usCitizenMultiplier[loanType];
    const amount = totalLiquidity * multiplier;
    const conditions: string[] = [];
    let belowMinimum = false;

    if (isForeignNational) {
      conditions.push('Non-U.S. citizen: 35% down payment required (maximum 65% LTV)');
      if (amount < NON_CITIZEN_MIN_LOAN) {
        belowMinimum = true;
        conditions.push(`Qualified amount is below the $${NON_CITIZEN_MIN_LOAN.toLocaleString()} minimum loan amount for non-U.S. citizens — requires manual review`);
      }
    }

    let summary = `${label} Pre-Approval: Up to $${amount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity (${multiplier}x multiplier)`;
    if (isForeignNational) summary += ' · Non-U.S. citizen: 35% down (65% max LTV)';
    if (belowMinimum) summary += ` · Below $${(NON_CITIZEN_MIN_LOAN / 1000)}k minimum — needs review`;

    return {
      borrower_id: borrowerId,
      loan_type: loanType,
      status: 'approved',
      sub_status: 'pre_approved',
      prequalified_amount: amount,
      qualification_max: amount,
      verified_liquidity: totalLiquidity,
      passes_liquidity_check: !belowMinimum,
      conditions: conditions.length ? conditions : null,
      summary,
      machine_decision: 'approved',
      machine_confidence: Math.round(avgConfidence * 100),
    };
  };

  // Delete old pre-approvals first
  await supabase.from('pre_approvals')
    .delete()
    .eq('borrower_id', borrowerId);

  await supabase.from('pre_approvals').insert([
    buildPreApproval('dscr', 'DSCR Loan'),
    buildPreApproval('fix_flip', 'Fix & Flip'),
    buildPreApproval('bridge', 'Bridge Loan'),
  ]);

  // Update borrower status to prequalified
  await supabase.from('borrowers')
    .update({ lifecycle_stage: 'pre_approved', borrower_status: 'prequalified' })
    .eq('id', borrowerId);

  return { totalLiquidity, extractions };
}
