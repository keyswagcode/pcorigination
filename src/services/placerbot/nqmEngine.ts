import type { BorrowerProfile } from './loanTypeRouter';

export interface NQMEngineResult {
  monthly_income: number | null;
  income_method: 'bank_statement' | 'wvoe' | 'w2' | null;
  expense_ratio_used: number;
  dti: number | null;
  max_dti: number;
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  warnings: string[];
  tradeline_status: 'meets_requirement' | 'needs_review' | 'insufficient';
}

const DEFAULT_EXPENSE_RATIO = 0.5;
const MAX_DTI = 50;
const MIN_CREDIT_FLOOR = 620;
const MIN_LOAN_AMOUNT = 100_000;
const NEAR_MIN_THRESHOLD = MIN_LOAN_AMOUNT * 0.95;

function calculateBankStatementIncome(
  totalDeposits: number,
  months: number,
  expenseRatio: number,
  ownershipPercentage: number
): number {
  return (totalDeposits * expenseRatio * ownershipPercentage) / months;
}

function evaluateTradelines(): { status: 'meets_requirement' | 'needs_review' | 'insufficient'; message: string } {
  return {
    status: 'needs_review',
    message: 'Tradeline verification: requires 3 tradelines reporting 12+ months, or 2 tradelines reporting 24+ months, or 24-month mortgage history',
  };
}

export function runNQMEngine(profile: BorrowerProfile): NQMEngineResult {
  const blockingReasons: string[] = [];
  const passingCriteria: string[] = [];
  const warnings: string[] = [];

  const creditScore = profile.credit_score;
  const { income_profile, loan_request } = profile;

  if (creditScore == null) {
    blockingReasons.push('Credit score not provided');
  } else if (creditScore < MIN_CREDIT_FLOOR) {
    blockingReasons.push(`Credit score ${creditScore} below NQM minimum ${MIN_CREDIT_FLOOR}`);
  } else {
    passingCriteria.push(`Credit score ${creditScore} meets NQM minimum of ${MIN_CREDIT_FLOOR}`);
  }

  const tradelineResult = evaluateTradelines();
  if (tradelineResult.status === 'insufficient') {
    blockingReasons.push('Insufficient tradeline history for NQM qualification');
  } else if (tradelineResult.status === 'needs_review') {
    warnings.push(tradelineResult.message);
  } else {
    passingCriteria.push('Tradeline requirements met');
  }

  let monthlyIncome: number | null = null;
  let incomeMethod: 'bank_statement' | 'wvoe' | 'w2' | null = null;
  const expenseRatioUsed = DEFAULT_EXPENSE_RATIO;

  if (income_profile.has_self_employed_income && income_profile.total_bank_deposits != null && income_profile.bank_statement_months != null) {
    const months = income_profile.bank_statement_months;
    const deposits = income_profile.total_bank_deposits;
    const ownership = income_profile.ownership_percentage;

    if (months !== 12 && months !== 24) {
      warnings.push(`Bank statement period ${months} months — standard periods are 12 or 24 months`);
    }

    if (income_profile.nsf_count_recent > 0) {
      blockingReasons.push(`Recent NSF activity (${income_profile.nsf_count_recent} occurrences) — not allowed for bank statement qualification`);
    } else {
      passingCriteria.push('No recent NSF activity on bank statements');
    }

    monthlyIncome = calculateBankStatementIncome(deposits, months, expenseRatioUsed, ownership);
    incomeMethod = 'bank_statement';

    passingCriteria.push(
      `Bank statement income: $${monthlyIncome.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month ` +
      `(${months} months, ${(expenseRatioUsed * 100).toFixed(0)}% expense ratio, ${(ownership * 100).toFixed(0)}% ownership)`
    );
  } else if (income_profile.has_w2_income) {
    incomeMethod = 'w2';
    warnings.push('W-2 income requires verification through pay stubs and employer documentation');
  } else {
    blockingReasons.push('No qualifying income method available — requires bank statements or W-2 documentation');
  }

  const dti: number | null = null;

  const requiredReserves = loan_request.loan_amount * 0.06;
  if (profile.assets.liquid_reserves < requiredReserves) {
    blockingReasons.push(
      `Reserves $${profile.assets.liquid_reserves.toLocaleString()} below required ` +
      `$${requiredReserves.toLocaleString()} (6 months PITIA)`
    );
  } else {
    passingCriteria.push(
      `Reserves $${profile.assets.liquid_reserves.toLocaleString()} meets ` +
      `$${requiredReserves.toLocaleString()} requirement`
    );
  }

  const loanAmount = loan_request.loan_amount;
  if (loanAmount < NEAR_MIN_THRESHOLD) {
    blockingReasons.push(`Loan amount $${loanAmount.toLocaleString()} below minimum $${MIN_LOAN_AMOUNT.toLocaleString()}`);
  } else if (loanAmount < MIN_LOAN_AMOUNT) {
    const shortfall = MIN_LOAN_AMOUNT - loanAmount;
    warnings.push(`Loan amount $${shortfall.toLocaleString()} below minimum — may be structurable with some lenders`);
  } else {
    passingCriteria.push(`Loan amount $${loanAmount.toLocaleString()} meets typical NQM minimum`);
  }

  if (profile.borrower_flags.foreign_national) {
    warnings.push('Foreign national — additional documentation and LTV restrictions may apply');
  }

  if (profile.borrower_flags.itin) {
    warnings.push('ITIN borrower — limited lender options, additional requirements');
  }

  return {
    monthly_income: monthlyIncome,
    income_method: incomeMethod,
    expense_ratio_used: expenseRatioUsed,
    dti,
    max_dti: MAX_DTI,
    eligible: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    passing_criteria: passingCriteria,
    warnings,
    tradeline_status: tradelineResult.status,
  };
}
