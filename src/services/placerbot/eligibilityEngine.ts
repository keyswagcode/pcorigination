import { routeLoanType, type BorrowerProfile, type LoanType, type QualificationPreference } from './loanTypeRouter';
import { runDSCREngine, type DSCREngineResult } from './dscrEngine';
import { runNQMEngine, type NQMEngineResult } from './nqmEngine';
import { runLenderPlacement, type LenderPlacementResult, type SalvageSuggestion } from './lenderPlacement';
import type { LoanPurpose, HousingHistory } from './verusEngine';

export interface DealInput {
  credit_score: number | null;
  dscr: number | null;
  monthly_rent?: number | null;
  monthly_payment?: number | null;
  property_type: string | null;
  seasoning_months: number | null;
  short_term_rental: boolean;
  foreign_national: boolean;
  first_time_investor: boolean;
  loan_amount?: number | null;
  property_value?: number | null;
  liquidity?: number | null;
  loan_purpose?: LoanPurpose | null;
  state?: string | null;
  is_vacant?: boolean;
  is_declining_market?: boolean;
  housing_history?: HousingHistory | null;
  credit_event_months_since?: number | null;
  occupancy_type?: 'investment' | 'primary' | 'second_home';
  has_rental_income?: boolean;
  has_self_employed_income?: boolean;
  has_w2_income?: boolean;
  bank_statement_months?: number | null;
  total_bank_deposits?: number | null;
  ownership_percentage?: number;
  nsf_count_recent?: number;
  recently_rehabbed?: boolean;
  listed_for_rent?: boolean;
  is_rural?: boolean;
  needs_speed?: boolean;
  qualification_preference?: QualificationPreference;
}

export interface DealFlag {
  id: string;
  label: string;
  type: 'warning' | 'positive';
}

export interface LenderResult {
  lender: {
    id: string;
    name: string;
    program: string;
    notes: string;
  };
  eligible: boolean;
  borderline?: boolean;
  reasons: string[];
  borderline_flags?: string[];
  max_allowed_ltv?: number | null;
  actual_ltv?: number | null;
  dscr?: number | null;
  reserves_months?: number | null;
  score?: number;
  fit_category?: string;
  passing_criteria?: string[];
  strategy_reason?: string;
  salvage_suggestions?: SalvageSuggestion[];
}

export interface PlacerBotResult {
  eligible: LenderResult[];
  borderline: LenderResult[];
  closest_options: LenderResult[];
  flags: DealFlag[];
  computed_dscr: number | null;
  normalized_property_type: string | null;
  recommended_loan_type: LoanType;
  routing_reason: string;
  validation_errors: string[];
  dscr_engine_result: DSCREngineResult | null;
  nqm_engine_result: NQMEngineResult | null;
}

function applyDemoDefaults(input: DealInput): DealInput {
  const loanAmount = input.loan_amount ?? 300000;
  const propertyValue = input.property_value ?? 400000;
  const monthlyPayment = input.monthly_payment ?? loanAmount * 0.007;
  const monthlyRent = input.monthly_rent ?? (input.dscr ? input.dscr * monthlyPayment : 2800);

  return {
    ...input,
    loan_amount: loanAmount,
    property_value: propertyValue,
    liquidity: input.liquidity ?? 50000,
    monthly_payment: monthlyPayment,
    monthly_rent: monthlyRent,
    credit_score: input.credit_score ?? 720,
    dscr: input.dscr ?? (monthlyRent / monthlyPayment),
    property_type: input.property_type ?? 'single_family',
    state: input.state ?? 'CA',
    seasoning_months: input.seasoning_months ?? 12,
    bank_statement_months: input.bank_statement_months ?? 3,
    total_bank_deposits: input.total_bank_deposits ?? 45000,
  };
}

function buildBorrowerProfile(input: DealInput): BorrowerProfile {
  const loanAmount = input.loan_amount ?? 0;
  const propertyValue = input.property_value ?? 0;
  const ltv = propertyValue > 0 ? (loanAmount / propertyValue) * 100 : 0;

  const occupancy = input.occupancy_type ??
    (input.property_type?.toLowerCase().includes('investment') ? 'investment' : 'investment');

  const hasRentalIncome = input.has_rental_income ?? (occupancy === 'investment');
  const hasSelfEmployedIncome = input.has_self_employed_income ?? false;
  const hasW2Income = input.has_w2_income ?? false;

  let monthlyRent = input.monthly_rent ?? null;
  if (monthlyRent == null && input.dscr != null && input.monthly_payment != null) {
    monthlyRent = input.dscr * input.monthly_payment;
  }

  const monthlyPayment = input.monthly_payment ?? (loanAmount > 0 ? loanAmount * 0.007 : null);

  return {
    credit_score: input.credit_score,
    occupancy,
    property_type: input.property_type,
    property_location: {
      state: input.state ?? null,
      county: null,
      is_rural: input.is_rural ?? false,
    },
    loan_request: {
      loan_amount: loanAmount,
      ltv,
      purpose: input.loan_purpose ?? 'purchase',
      cash_out: input.loan_purpose === 'cash_out_refinance',
    },
    income_profile: {
      monthly_rent: monthlyRent,
      market_rent: monthlyRent,
      lease_rent: null,
      pitia: monthlyPayment,
      has_rental_income: hasRentalIncome,
      has_w2_income: hasW2Income,
      has_self_employed_income: hasSelfEmployedIncome,
      bank_statement_months: input.bank_statement_months ?? null,
      total_bank_deposits: input.total_bank_deposits ?? null,
      ownership_percentage: input.ownership_percentage ?? 1.0,
      nsf_count_recent: input.nsf_count_recent ?? 0,
    },
    property_profile: {
      seasoning_months: input.seasoning_months ?? 12,
      recently_rehabbed: input.recently_rehabbed ?? false,
      listed_for_rent: input.listed_for_rent ?? false,
      short_term_rental: input.short_term_rental,
    },
    borrower_flags: {
      foreign_national: input.foreign_national,
      itin: false,
      first_time_investor: input.first_time_investor,
      needs_speed: input.needs_speed ?? false,
    },
    assets: {
      liquid_reserves: input.liquidity ?? 0,
    },
    qualification_preference: input.qualification_preference ?? 'auto',
  };
}

function computeFlags(input: DealInput, dscr: number | null): DealFlag[] {
  const flags: DealFlag[] = [];

  if (input.credit_score != null && input.credit_score < 680) {
    flags.push({ id: 'low_credit', label: 'Low Credit', type: 'warning' });
  }

  if (input.seasoning_months != null && input.seasoning_months < 6) {
    flags.push({ id: 'no_seasoning', label: 'No Seasoning', type: 'warning' });
  }

  if (dscr != null && dscr < 1.0) {
    flags.push({ id: 'weak_dscr', label: 'Weak DSCR', type: 'warning' });
  }

  if (input.short_term_rental) {
    flags.push({ id: 'str', label: 'Short-Term Rental', type: 'warning' });
  }

  if (input.is_vacant) {
    flags.push({ id: 'vacant', label: 'Vacant Property', type: 'warning' });
  }

  if (input.foreign_national) {
    flags.push({ id: 'foreign_national', label: 'Foreign National', type: 'warning' });
  }

  if (input.first_time_investor) {
    flags.push({ id: 'first_time', label: 'First-Time Investor', type: 'warning' });
  }

  const loanAmount = input.loan_amount ?? 0;
  if (loanAmount > 0 && loanAmount < 100_000) {
    flags.push({ id: 'low_loan_amount', label: 'Low Loan Amount', type: 'warning' });
  } else if (loanAmount >= 100_000 && loanAmount < 150_000) {
    flags.push({ id: 'near_min_loan', label: 'Near Minimum Loan', type: 'warning' });
  }

  if (
    input.credit_score != null &&
    input.credit_score >= 720 &&
    dscr != null &&
    dscr >= 1.2
  ) {
    flags.push({ id: 'strong_borrower', label: 'Strong Borrower', type: 'positive' });
  }

  if (loanAmount >= 250_000 && input.credit_score != null && input.credit_score >= 700) {
    flags.push({ id: 'solid_deal', label: 'Solid Deal Profile', type: 'positive' });
  }

  return flags;
}

function convertPlacementResult(result: LenderPlacementResult): LenderResult {
  return {
    lender: {
      id: result.program.id,
      name: result.program.lender,
      program: result.program.program,
      notes: result.strategy_reason,
    },
    eligible: result.eligible,
    borderline: result.fit_category === 'conditional_fit' || result.fit_category === 'closest_option',
    reasons: result.blocking_reasons,
    borderline_flags: result.qualification_gaps,
    max_allowed_ltv: result.program.max_ltv ?? null,
    actual_ltv: null,
    dscr: null,
    reserves_months: null,
    score: result.score,
    fit_category: result.fit_category,
    passing_criteria: result.passing_criteria,
    strategy_reason: result.strategy_reason,
    salvage_suggestions: result.salvage_suggestions,
  };
}

export function runPlacerBot(input: DealInput): PlacerBotResult {
  const safeInput = applyDemoDefaults(input);

  const profile = buildBorrowerProfile(safeInput);
  const routingResult = routeLoanType(profile);
  const loanType = routingResult.recommended_loan_type;

  let dscrResult: DSCREngineResult | null = null;
  let nqmResult: NQMEngineResult | null = null;

  if (loanType === 'DSCR') {
    dscrResult = runDSCREngine(profile);
  } else if (loanType === 'NQM') {
    nqmResult = runNQMEngine(profile);
  }

  const placementResults = runLenderPlacement(loanType, profile, dscrResult, nqmResult);

  const eligibleResults = placementResults.filter(r => r.eligible && r.fit_category !== 'conditional_fit');
  const borderlineResults = placementResults.filter(r => r.eligible && r.fit_category === 'conditional_fit');
  const closestOptions = placementResults.filter(r => r.fit_category === 'closest_option');

  const dscr = dscrResult?.dscr ?? (safeInput.dscr ?? null);
  const flags = computeFlags(safeInput, dscr);

  return {
    eligible: eligibleResults.map(convertPlacementResult),
    borderline: borderlineResults.map(convertPlacementResult),
    closest_options: closestOptions.map(convertPlacementResult),
    flags,
    computed_dscr: dscr,
    normalized_property_type: profile.property_type,
    recommended_loan_type: loanType,
    routing_reason: routingResult.routing_reason,
    validation_errors: [],
    dscr_engine_result: dscrResult,
    nqm_engine_result: nqmResult,
  };
}
