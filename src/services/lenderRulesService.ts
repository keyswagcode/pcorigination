import { supabase } from './supabaseClient';
import type { EligibilityResult, EligibilityCheck, LoanPackage, SalvageSuggestion } from '../shared/types';
import { runLenderPlacement, type FitCategory } from './placerbot/lenderPlacement';
import { runDSCREngine } from './placerbot/dscrEngine';
import { runNQMEngine } from './placerbot/nqmEngine';
import { routeLoanType, type BorrowerProfile } from './placerbot/loanTypeRouter';

export function checkCredit(score: number | null, min: number | null): EligibilityCheck {
  if (!min) return { rule: 'credit_score', passed: true, detail: 'No minimum credit score required' };
  if (!score) return { rule: 'credit_score', passed: false, detail: 'Credit score not provided' };
  const passed = score >= min;
  return {
    rule: 'credit_score',
    passed,
    detail: passed
      ? `Credit score ${score} meets minimum ${min}`
      : `Credit score ${score} below minimum ${min}`,
  };
}

export function checkLTV(ltv: number, maxLtv: number | null): EligibilityCheck {
  if (!maxLtv) return { rule: 'ltv', passed: true, detail: 'No LTV limit specified' };
  const ltvPct = ltv > 1 ? ltv : ltv * 100;
  const maxPct = maxLtv > 1 ? maxLtv : maxLtv * 100;
  const passed = ltvPct <= maxPct;
  return {
    rule: 'ltv',
    passed,
    detail: passed
      ? `LTV ${ltvPct.toFixed(1)}% within limit of ${maxPct.toFixed(1)}%`
      : `LTV ${ltvPct.toFixed(1)}% exceeds maximum ${maxPct.toFixed(1)}%`,
  };
}

export function checkDSCR(dscr: number | null, min: number | null, required: boolean): EligibilityCheck {
  if (!required || !min) return { rule: 'dscr', passed: true, detail: 'DSCR not required' };
  if (!dscr) return { rule: 'dscr', passed: false, detail: 'DSCR not provided but required' };
  const passed = dscr >= min;
  return {
    rule: 'dscr',
    passed,
    detail: passed
      ? `DSCR ${dscr.toFixed(2)} meets minimum ${min.toFixed(2)}`
      : `DSCR ${dscr.toFixed(2)} below minimum ${min.toFixed(2)}`,
  };
}

export function checkLoanAmount(amount: number, min: number | null, max: number | null): EligibilityCheck {
  if (min && amount < min) {
    return { rule: 'loan_amount', passed: false, detail: `Amount $${amount.toLocaleString()} below minimum $${min.toLocaleString()}` };
  }
  if (max && amount > max) {
    return { rule: 'loan_amount', passed: false, detail: `Amount $${amount.toLocaleString()} exceeds maximum $${max.toLocaleString()}` };
  }
  return { rule: 'loan_amount', passed: true, detail: 'Loan amount within range' };
}

export function checkProperty(
  state: string,
  loanType: string,
  programOrPropertyType: { loan_type: string | null } | string | null,
  program?: { loan_type: string | null }
): EligibilityCheck {
  const resolvedProgram: { loan_type: string | null } = program ||
    (typeof programOrPropertyType === 'object' && programOrPropertyType !== null
      ? programOrPropertyType
      : { loan_type: null });
  if (resolvedProgram.loan_type && resolvedProgram.loan_type !== loanType) {
    return { rule: 'property', passed: false, detail: `Program requires ${resolvedProgram.loan_type}` };
  }
  if (!state) return { rule: 'property', passed: false, detail: 'Property state not specified' };
  return { rule: 'property', passed: true, detail: 'Property eligibility met' };
}

function buildBorrowerProfile(pkg: LoanPackage): BorrowerProfile {
  const loanAmount = pkg.loan_terms.requested_amount || 300000;
  const purchasePrice = pkg.loan_terms.purchase_price || pkg.property_details.purchase_price || 400000;
  const ltv = purchasePrice > 0 ? (loanAmount / purchasePrice) * 100 : 75;

  const occupancy = pkg.loan_terms.occupancy_type?.toLowerCase().includes('investment')
    ? 'investment'
    : pkg.loan_terms.occupancy_type?.toLowerCase().includes('primary')
      ? 'primary'
      : 'investment';

  const purpose = pkg.loan_terms.transaction_type?.toLowerCase().includes('purchase')
    ? 'purchase'
    : pkg.loan_terms.transaction_type?.toLowerCase().includes('cash')
      ? 'cash_out_refinance'
      : 'rate_term_refinance';

  const hasBankStatements = pkg.financial_metrics.months_of_data > 0;
  const hasRentalIncome = occupancy === 'investment';

  const monthlyPayment = loanAmount * 0.007;
  const estimatedDscr = pkg.borrower_profile.estimated_dscr;
  const estimatedRent = estimatedDscr != null && monthlyPayment > 0
    ? estimatedDscr * monthlyPayment
    : monthlyPayment * 1.25;

  return {
    credit_score: pkg.borrower_profile.credit_score,
    occupancy,
    property_type: pkg.property_details.property_type || 'single_family',
    property_location: {
      state: pkg.property_details.address_state || 'CA',
      county: null,
      is_rural: false,
    },
    loan_request: {
      loan_amount: loanAmount,
      ltv,
      purpose,
      cash_out: purpose === 'cash_out_refinance',
    },
    income_profile: {
      monthly_rent: estimatedRent,
      market_rent: estimatedRent,
      lease_rent: null,
      pitia: monthlyPayment,
      has_rental_income: hasRentalIncome,
      has_w2_income: false,
      has_self_employed_income: hasBankStatements,
      bank_statement_months: pkg.financial_metrics.months_of_data > 0 ? pkg.financial_metrics.months_of_data : 3,
      total_bank_deposits: pkg.financial_metrics.avg_monthly_deposits * Math.max(pkg.financial_metrics.months_of_data, 3),
      ownership_percentage: 1.0,
      nsf_count_recent: 0,
    },
    property_profile: {
      seasoning_months: 12,
      recently_rehabbed: false,
      listed_for_rent: false,
      short_term_rental: false,
    },
    borrower_flags: {
      foreign_national: pkg.borrower_profile.is_foreign_national,
      itin: false,
      first_time_investor: pkg.borrower_profile.is_first_time_investor,
      needs_speed: false,
    },
    assets: {
      liquid_reserves: pkg.financial_metrics.total_available_cash,
    },
  };
}

export async function evaluateLoanPackage(loanPackage: LoanPackage): Promise<EligibilityResult[]> {
  const profile = buildBorrowerProfile(loanPackage);
  const routingResult = routeLoanType(profile);
  const loanType = routingResult.recommended_loan_type;

  let dscrResult = null;
  let nqmResult = null;

  if (loanType === 'DSCR' || routingResult.alternate_loan_type === 'DSCR') {
    dscrResult = runDSCREngine(profile);
  }

  if (loanType === 'NQM' || routingResult.alternate_loan_type === 'NQM') {
    nqmResult = runNQMEngine(profile);
  }

  const placementResults = runLenderPlacement(loanType, profile, dscrResult, nqmResult);

  return placementResults.map((pr) => {
    const checks: EligibilityCheck[] = [];

    for (const criterion of pr.passing_criteria) {
      checks.push({ rule: 'passing', passed: true, detail: criterion });
    }
    for (const reason of pr.blocking_reasons) {
      checks.push({ rule: 'blocking', passed: false, detail: reason });
    }

    const salvageSuggestions: SalvageSuggestion[] = pr.salvage_suggestions.map(s => ({
      field: s.field,
      current_value: s.current_value,
      required_value: s.required_value,
      fix: s.fix,
    }));

    return {
      program_id: pr.program.id,
      lender_name: pr.program.lender,
      program_name: pr.program.program,
      eligible: pr.eligible,
      checks,
      blocking_reasons: pr.blocking_reasons,
      passing_criteria: pr.passing_criteria,
      qualification_gaps: pr.qualification_gaps,
      salvage_suggestions: salvageSuggestions,
      score: pr.score,
      fit_category: pr.fit_category as FitCategory,
      strategy_reason: pr.strategy_reason,
    };
  });
}

export async function runServerEligibility(submissionId: string): Promise<unknown> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evaluate-rules`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ submission_id: submissionId }),
    }
  );
  if (!response.ok) throw new Error('Rule evaluation failed');
  return response.json();
}

export async function fetchLenderPrograms() {
  const { data } = await supabase
    .from('lender_programs')
    .select(`
      id, program_name, loan_type, min_credit_score, max_ltv, min_dscr,
      dscr_required, min_loan_amount, max_loan_amount, is_active,
      lenders (id, name)
    `)
    .eq('is_active', true);

  return data || [];
}
