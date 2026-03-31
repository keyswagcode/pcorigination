import { routeLoanType, type BorrowerProfile, type LoanType, type RouterResult } from './loanTypeRouter';
import { runDSCREngine, type DSCREngineResult } from './dscrEngine';
import { runNQMEngine, type NQMEngineResult } from './nqmEngine';
import { runLenderPlacement, type LenderPlacementResult } from './lenderPlacement';
import type { LoanPackage } from '../../shared/types';

export interface PlacerBotOutput {
  recommended_loan_type: LoanType;
  routing_result: RouterResult;
  dscr_result: DSCREngineResult | null;
  nqm_result: NQMEngineResult | null;
  lender_results: LenderPlacementResult[];
  summary: string;
}

export interface UILenderResult {
  lender: string;
  program: string;
  score: number;
  fit_category: 'strong_fit' | 'good_fit' | 'conditional_fit' | 'closest_option' | 'no_fit';
  eligible: boolean;
  why_this_matches: string[];
  program_mismatch: string[];
  qualification_gaps: string[];
  strategy_reason: string;
  blocking_reasons: string[];
  passing_criteria: string[];
  key_insight: string;
}

export interface PlacerBotUIOutput {
  recommended_loan_type: LoanType;
  summary: string;
  results: UILenderResult[];
  engine_details: {
    dscr: DSCREngineResult | null;
    nqm: NQMEngineResult | null;
  };
}

function applyDemoDefaults(pkg: LoanPackage): LoanPackage {
  const loanAmount = pkg.loan_terms.requested_amount || 300000;
  const purchasePrice = pkg.loan_terms.purchase_price || pkg.property_details.purchase_price || 400000;
  const liquidity = pkg.financial_metrics.total_available_cash || 50000;
  const monthlyPayment = loanAmount * 0.007;
  const monthlyRent = pkg.borrower_profile.estimated_dscr
    ? pkg.borrower_profile.estimated_dscr * monthlyPayment
    : 2800;

  return {
    ...pkg,
    loan_terms: {
      ...pkg.loan_terms,
      requested_amount: loanAmount,
      purchase_price: purchasePrice,
    },
    property_details: {
      ...pkg.property_details,
      purchase_price: purchasePrice,
    },
    financial_metrics: {
      ...pkg.financial_metrics,
      total_available_cash: liquidity,
      avg_monthly_deposits: pkg.financial_metrics.avg_monthly_deposits || 15000,
      months_of_data: pkg.financial_metrics.months_of_data || 3,
    },
    borrower_profile: {
      ...pkg.borrower_profile,
      credit_score: pkg.borrower_profile.credit_score || 720,
      estimated_dscr: pkg.borrower_profile.estimated_dscr ?? (monthlyRent / monthlyPayment),
    },
  };
}

function buildBorrowerProfile(pkg: LoanPackage): BorrowerProfile {
  const safePkg = applyDemoDefaults(pkg);

  const loanAmount = safePkg.loan_terms.requested_amount;
  const purchasePrice = safePkg.loan_terms.purchase_price || safePkg.property_details.purchase_price;
  const ltv = purchasePrice > 0 ? (loanAmount / purchasePrice) * 100 : 75;

  const occupancy = safePkg.loan_terms.occupancy_type?.toLowerCase().includes('investment')
    ? 'investment'
    : safePkg.loan_terms.occupancy_type?.toLowerCase().includes('primary')
      ? 'primary'
      : 'investment';

  const purpose = safePkg.loan_terms.transaction_type?.toLowerCase().includes('purchase')
    ? 'purchase'
    : safePkg.loan_terms.transaction_type?.toLowerCase().includes('cash')
      ? 'cash_out_refinance'
      : 'rate_term_refinance';

  const hasBankStatements = safePkg.financial_metrics.months_of_data > 0;
  const hasRentalIncome = occupancy === 'investment';

  const monthlyPayment = loanAmount * 0.007;
  const estimatedDscr = safePkg.borrower_profile.estimated_dscr;
  const estimatedRent = estimatedDscr != null && monthlyPayment > 0
    ? estimatedDscr * monthlyPayment
    : monthlyPayment * 1.25;

  return {
    credit_score: safePkg.borrower_profile.credit_score,
    occupancy,
    property_type: safePkg.property_details.property_type || 'single_family',
    property_location: {
      state: safePkg.property_details.address_state || 'CA',
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
      bank_statement_months: safePkg.financial_metrics.months_of_data > 0 ? safePkg.financial_metrics.months_of_data : 3,
      total_bank_deposits: safePkg.financial_metrics.avg_monthly_deposits * safePkg.financial_metrics.months_of_data,
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
      foreign_national: safePkg.borrower_profile.is_foreign_national,
      itin: false,
      first_time_investor: safePkg.borrower_profile.is_first_time_investor,
      needs_speed: false,
    },
    assets: {
      liquid_reserves: safePkg.financial_metrics.total_available_cash,
    },
  };
}

export function runPlacerBotFull(pkg: LoanPackage): PlacerBotOutput {
  const profile = buildBorrowerProfile(pkg);

  const routingResult = routeLoanType(profile);
  const loanType = routingResult.recommended_loan_type;

  let dscrResult: DSCREngineResult | null = null;
  let nqmResult: NQMEngineResult | null = null;

  if (loanType === 'DSCR' || routingResult.alternate_loan_type === 'DSCR') {
    dscrResult = runDSCREngine(profile);
  }

  if (loanType === 'NQM' || routingResult.alternate_loan_type === 'NQM') {
    nqmResult = runNQMEngine(profile);
  }

  const lenderResults = runLenderPlacement(loanType, profile, dscrResult, nqmResult);

  const eligibleCount = lenderResults.filter(r => r.eligible).length;
  const summary = `${loanType} loan type recommended. ${eligibleCount} of ${lenderResults.length} lenders qualify based on borrower profile.`;

  return {
    recommended_loan_type: loanType,
    routing_result: routingResult,
    dscr_result: dscrResult,
    nqm_result: nqmResult,
    lender_results: lenderResults,
    summary,
  };
}

export function formatForUI(output: PlacerBotOutput): PlacerBotUIOutput {
  const results: UILenderResult[] = output.lender_results.map(lr => ({
    lender: lr.program.lender,
    program: lr.program.program,
    score: Math.min(lr.score, 100),
    fit_category: lr.fit_category,
    eligible: lr.eligible,
    why_this_matches: lr.passing_criteria,
    program_mismatch: lr.blocking_reasons,
    qualification_gaps: lr.qualification_gaps,
    strategy_reason: lr.strategy_reason,
    blocking_reasons: lr.blocking_reasons,
    passing_criteria: lr.passing_criteria,
    key_insight: lr.key_insight,
  }));

  return {
    recommended_loan_type: output.recommended_loan_type,
    summary: output.summary,
    results,
    engine_details: {
      dscr: output.dscr_result,
      nqm: output.nqm_result,
    },
  };
}

export { buildBorrowerProfile };
