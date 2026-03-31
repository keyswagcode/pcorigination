export type LoanPurpose = 'purchase' | 'rate_term_refinance' | 'cash_out_refinance';
export type BorrowerExperience = 'experienced' | 'first_time_investor';
export type HousingHistory = 'clean' | '1x30' | '0x60' | 'other';

export interface VerusInput {
  credit_score: number;
  loan_amount: number;
  property_value: number;
  estimated_rent: number;
  liquidity: number;
  loan_purpose: LoanPurpose;
  property_type: string;
  state?: string;
  is_short_term_rental?: boolean;
  is_vacant?: boolean;
  is_declining_market?: boolean;
  borrower_experience: BorrowerExperience;
  housing_history: HousingHistory;
  credit_event_months_since?: number;
}

export type VerusStatus = 'eligible' | 'borderline' | 'not_eligible';

export interface VerusResult {
  status: VerusStatus;
  max_allowed_ltv: number | null;
  actual_ltv: number;
  dscr: number | null;
  credit_score: number;
  reserves_months: number;
  fail_reasons: string[];
  borderline_flags: string[];
}

const ALLOWED_PROPERTY_TYPES = ['sfr', 'condo', 'townhouse', '2-4 unit', '2 unit', '3 unit', '4 unit'];
const HIGH_COST_STATES = ['CT', 'FL', 'IL', 'NJ', 'NY'];
const BLOCKED_STATES = ['PR', 'GU', 'VI'];

type CreditBucket = '700+' | '680-699' | '660-679' | '640-659';
type DscrBucket = '>=1.00' | '<1.00';
type LoanAmountBucket = 1_000_000 | 1_500_000 | 2_000_000 | 2_500_000 | 3_000_000 | 3_500_000;

interface MatrixEntry {
  purchase: number | null;
  rate_term: number | null;
  cash_out: number | null;
}

type MatrixRow = Partial<Record<LoanAmountBucket, MatrixEntry>>;
type MatrixTable = Record<CreditBucket, MatrixRow>;

const DSCR_GTE_MATRIX: MatrixTable = {
  '700+': {
    1_000_000: { purchase: 80, rate_term: 75, cash_out: 75 },
    1_500_000: { purchase: 80, rate_term: 75, cash_out: 75 },
    2_000_000: { purchase: 75, rate_term: 70, cash_out: 70 },
    3_000_000: { purchase: 70, rate_term: 65, cash_out: 65 },
    3_500_000: { purchase: 70, rate_term: 65, cash_out: null },
  },
  '680-699': {
    1_000_000: { purchase: 75, rate_term: 75, cash_out: 70 },
    1_500_000: { purchase: 75, rate_term: 70, cash_out: 70 },
    2_000_000: { purchase: 70, rate_term: 65, cash_out: 65 },
    2_500_000: { purchase: 70, rate_term: 65, cash_out: 65 },
    3_000_000: { purchase: 65, rate_term: null, cash_out: null },
  },
  '660-679': {
    1_000_000: { purchase: 75, rate_term: 70, cash_out: null },
    1_500_000: { purchase: 65, rate_term: 65, cash_out: null },
    2_000_000: { purchase: 65, rate_term: null, cash_out: null },
    3_000_000: { purchase: 60, rate_term: null, cash_out: null },
  },
  '640-659': {
    1_000_000: { purchase: 75, rate_term: 70, cash_out: null },
    1_500_000: { purchase: 65, rate_term: 65, cash_out: null },
    2_000_000: { purchase: 65, rate_term: null, cash_out: null },
    3_000_000: { purchase: 60, rate_term: null, cash_out: null },
  },
};

const DSCR_LT_MATRIX: MatrixTable = {
  '700+': {
    1_000_000: { purchase: 75, rate_term: 70, cash_out: 70 },
    1_500_000: { purchase: 75, rate_term: 70, cash_out: 70 },
    2_000_000: { purchase: 70, rate_term: 65, cash_out: 65 },
    2_500_000: { purchase: 65, rate_term: null, cash_out: null },
    3_000_000: { purchase: 60, rate_term: null, cash_out: null },
  },
  '680-699': {
    1_000_000: { purchase: 70, rate_term: 65, cash_out: null },
    1_500_000: { purchase: 70, rate_term: 65, cash_out: null },
    2_000_000: { purchase: 65, rate_term: 60, cash_out: null },
    3_000_000: { purchase: 60, rate_term: null, cash_out: null },
  },
  '660-679': {
    1_000_000: { purchase: 65, rate_term: null, cash_out: null },
  },
  '640-659': {
    1_000_000: { purchase: null, rate_term: null, cash_out: null },
  },
};

const LOAN_AMOUNT_BUCKETS: LoanAmountBucket[] = [
  1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000, 3_500_000,
];

function getCreditBucket(score: number): CreditBucket {
  if (score >= 700) return '700+';
  if (score >= 680) return '680-699';
  if (score >= 660) return '660-679';
  return '640-659';
}

function getLoanAmountBucket(amount: number): LoanAmountBucket | null {
  for (const bucket of LOAN_AMOUNT_BUCKETS) {
    if (amount <= bucket) return bucket;
  }
  return null;
}

function matrixLookup(
  dscrBucket: DscrBucket,
  creditBucket: CreditBucket,
  loanAmountBucket: LoanAmountBucket,
  purpose: LoanPurpose
): number | null {
  const matrix = dscrBucket === '>=1.00' ? DSCR_GTE_MATRIX : DSCR_LT_MATRIX;
  const row = matrix[creditBucket];
  if (!row) return null;
  const entry = row[loanAmountBucket];
  if (!entry) return null;
  if (purpose === 'purchase') return entry.purchase;
  if (purpose === 'rate_term_refinance') return entry.rate_term;
  if (purpose === 'cash_out_refinance') return entry.cash_out;
  return null;
}

export function runVerusEngine(input: VerusInput): VerusResult {
  const failReasons: string[] = [];
  const borderlineFlags: string[] = [];

  const ltv = (input.loan_amount / input.property_value) * 100;
  const monthlyPayment = input.loan_amount * 0.0075;
  const dscr = monthlyPayment > 0 ? input.estimated_rent / monthlyPayment : null;
  const reservesMonths = monthlyPayment > 0 ? input.liquidity / monthlyPayment : 0;

  const normalizedPropertyType = input.property_type.toLowerCase().replace(/[-_]/g, ' ');
  const propertyTypeAllowed = ALLOWED_PROPERTY_TYPES.some(t => normalizedPropertyType.includes(t) || t.includes(normalizedPropertyType));

  if (!propertyTypeAllowed) {
    failReasons.push(`Property type "${input.property_type}" not eligible (SFR, Condo, Townhouse, 2–4 Unit only)`);
  }

  if (input.credit_score < 640) {
    failReasons.push(`Credit score ${input.credit_score} below minimum 640`);
  }

  if (input.property_value < 100_000) {
    failReasons.push('Property value below $100,000 minimum');
  }

  if (input.state && BLOCKED_STATES.includes(input.state.toUpperCase())) {
    failReasons.push(`State ${input.state} not eligible`);
  }

  if (input.loan_amount > 3_500_000) {
    failReasons.push('Loan amount exceeds $3,500,000 maximum');
  }

  if (input.borrower_experience === 'first_time_investor') {
    if (input.credit_score < 680) {
      failReasons.push('First-time investor requires credit score ≥ 680');
    }
    if (input.loan_purpose === 'cash_out_refinance') {
      failReasons.push('First-time investor not eligible for cash-out refinance');
    }
    if (input.credit_event_months_since != null && input.credit_event_months_since < 36) {
      failReasons.push('First-time investor requires credit event seasoning ≥ 36 months');
    }
  }

  if (input.housing_history === '0x60' || input.housing_history === 'other') {
    failReasons.push(`Housing history "${input.housing_history}" is not eligible`);
  }

  if (input.credit_event_months_since != null && input.credit_event_months_since < 24) {
    failReasons.push('Credit event seasoning < 24 months — not eligible');
  }

  if (dscr == null) {
    borderlineFlags.push('DSCR cannot be computed — rent or payment missing');
  }

  if (reservesMonths < 1) {
    failReasons.push(`Reserves of ${reservesMonths.toFixed(1)} months below 1-month minimum`);
  }

  if (failReasons.length > 0) {
    return {
      status: 'not_eligible',
      max_allowed_ltv: null,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: failReasons,
      borderline_flags: borderlineFlags,
    };
  }

  const dscrBucket: DscrBucket = (dscr != null && dscr >= 1.0) ? '>=1.00' : '<1.00';
  const creditBucket = getCreditBucket(input.credit_score);
  const loanAmountBucket = getLoanAmountBucket(input.loan_amount);

  if (!loanAmountBucket) {
    failReasons.push('Loan amount exceeds maximum program limit');
    return {
      status: 'not_eligible',
      max_allowed_ltv: null,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: failReasons,
      borderline_flags: borderlineFlags,
    };
  }

  let maxLtv = matrixLookup(dscrBucket, creditBucket, loanAmountBucket, input.loan_purpose);

  if (maxLtv === null) {
    failReasons.push(`No eligible matrix cell for: ${dscrBucket} DSCR / ${creditBucket} credit / $${(input.loan_amount / 1_000_000).toFixed(1)}M loan / ${input.loan_purpose}`);
    return {
      status: 'not_eligible',
      max_allowed_ltv: null,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: failReasons,
      borderline_flags: borderlineFlags,
    };
  }

  const MIN_LOAN_AMOUNT = 100_000;
  const NEAR_MIN_THRESHOLD = MIN_LOAN_AMOUNT * 0.95;

  if (input.loan_amount < NEAR_MIN_THRESHOLD) {
    failReasons.push(`Loan amount $${input.loan_amount.toLocaleString()} below minimum $${MIN_LOAN_AMOUNT.toLocaleString()}`);
  } else if (input.loan_amount < MIN_LOAN_AMOUNT) {
    const shortfall = MIN_LOAN_AMOUNT - input.loan_amount;
    borderlineFlags.push(`Loan amount $${shortfall.toLocaleString()} below minimum — may be structurable`);
  }

  if (input.loan_amount < 150_000) {
    if (dscr == null || dscr < 1.25) {
      if (input.loan_amount >= NEAR_MIN_THRESHOLD) {
        borderlineFlags.push('Loans under $150K typically require DSCR ≥ 1.25 — may need structuring');
      } else {
        failReasons.push('Loans below $150K require DSCR ≥ 1.25');
      }
    }
  }

  const isHighCostState = input.state && HIGH_COST_STATES.includes(input.state.toUpperCase());
  if (isHighCostState || input.is_declining_market) {
    const tag = isHighCostState ? `state ${input.state}` : 'declining market';
    const statePurchaseCap = 75;
    const stateRefiCap = 70;
    const stateLoanMax = 2_000_000;
    if (input.loan_purpose === 'purchase') maxLtv = Math.min(maxLtv, statePurchaseCap);
    else maxLtv = Math.min(maxLtv, stateRefiCap);
    if (input.loan_amount > stateLoanMax) {
      failReasons.push(`${tag} overlay: loan amount exceeds $2M limit`);
    } else {
      borderlineFlags.push(`${tag} overlay applied — LTV capped at ${input.loan_purpose === 'purchase' ? statePurchaseCap : stateRefiCap}%`);
    }
  }

  if (input.is_short_term_rental) {
    const adjustedRent = input.estimated_rent * 0.8;
    const strDscr = monthlyPayment > 0 ? adjustedRent / monthlyPayment : null;
    const strPurchaseCap = 75;
    const strRefiCap = 70;
    if (input.loan_purpose === 'purchase') maxLtv = Math.min(maxLtv, strPurchaseCap);
    else maxLtv = Math.min(maxLtv, strRefiCap);
    if (strDscr != null && strDscr < 1.0) {
      borderlineFlags.push(`STR DSCR after 80% haircut: ${strDscr.toFixed(2)} — borderline`);
    }
    borderlineFlags.push(`Short-term rental overlay applied — LTV capped at ${input.loan_purpose === 'purchase' ? strPurchaseCap : strRefiCap}%`);
  }

  if (input.is_vacant && input.loan_purpose !== 'purchase') {
    maxLtv = Math.min(maxLtv, 70);
    borderlineFlags.push('Vacant property refinance overlay — LTV capped at 70%');
  }

  if (input.housing_history === '1x30') {
    const h1Cap = input.loan_purpose === 'purchase' ? 70 : 65;
    maxLtv = Math.min(maxLtv, h1Cap);
    borderlineFlags.push(`1x30 housing history overlay — LTV capped at ${h1Cap}%`);
  }

  if (input.credit_event_months_since != null) {
    if (input.credit_event_months_since < 36) {
      const ceCap = input.loan_purpose === 'purchase' ? 75 : 70;
      maxLtv = Math.min(maxLtv, ceCap);
      borderlineFlags.push(`Credit event < 36 months ago — LTV capped at ${ceCap}%`);
    }
  }

  if (failReasons.length > 0) {
    return {
      status: 'not_eligible',
      max_allowed_ltv: maxLtv,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: failReasons,
      borderline_flags: borderlineFlags,
    };
  }

  if (ltv > maxLtv) {
    failReasons.push(`LTV ${ltv.toFixed(1)}% exceeds maximum ${maxLtv}% for this scenario`);
    return {
      status: 'not_eligible',
      max_allowed_ltv: maxLtv,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: failReasons,
      borderline_flags: borderlineFlags,
    };
  }

  if (dscr == null || reservesMonths < 3 || borderlineFlags.length > 0 || (maxLtv - ltv) < 3) {
    if (dscr == null) borderlineFlags.push('DSCR missing');
    if (reservesMonths < 3 && reservesMonths >= 1) borderlineFlags.push(`Reserves ${reservesMonths.toFixed(1)} months — below 3-month threshold`);
    if ((maxLtv - ltv) < 3) borderlineFlags.push(`LTV ${ltv.toFixed(1)}% close to limit of ${maxLtv}%`);

    return {
      status: 'borderline',
      max_allowed_ltv: maxLtv,
      actual_ltv: ltv,
      dscr,
      credit_score: input.credit_score,
      reserves_months: reservesMonths,
      fail_reasons: [],
      borderline_flags: borderlineFlags,
    };
  }

  return {
    status: 'eligible',
    max_allowed_ltv: maxLtv,
    actual_ltv: ltv,
    dscr,
    credit_score: input.credit_score,
    reserves_months: reservesMonths,
    fail_reasons: [],
    borderline_flags: [],
  };
}
