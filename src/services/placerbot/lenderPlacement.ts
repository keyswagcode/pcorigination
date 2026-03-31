import type { BorrowerProfile, LoanType } from './loanTypeRouter';
import type { DSCREngineResult } from './dscrEngine';
import type { NQMEngineResult } from './nqmEngine';

export type FitCategory = 'strong_fit' | 'good_fit' | 'conditional_fit' | 'closest_option' | 'no_fit';

export interface LenderProgram {
  id: string;
  lender: string;
  program: string;
  loan_type: LoanType;
  priority: number;
  role: string;
  min_credit?: number;
  min_dscr?: number;
  max_ltv?: number;
  min_loan_amount?: number;
  max_loan_amount?: number;
  no_minimum_loan?: boolean;
  no_seasoning_supported: boolean;
  low_credit_supported: boolean;
  high_leverage_supported: boolean;
  short_term_rental_allowed: boolean;
  foreign_national_allowed: boolean;
  rural_allowed: boolean;
  recently_rehabbed_allowed: boolean;
}

export interface SalvageSuggestion {
  field: string;
  current_value: string;
  required_value: string;
  fix: string;
}

export interface LenderPlacementResult {
  program: LenderProgram;
  score: number;
  fit_category: FitCategory;
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  strategy_reason: string;
  qualification_gaps: string[];
  salvage_suggestions: SalvageSuggestion[];
  indicative_rate: number | null;
  key_insight: string;
}

const BASE_PROGRAM_RULES: Record<string, { min_loan_amount?: number }> = {
  DSCR: { min_loan_amount: 100000 },
  NQM: { min_loan_amount: 100000 },
};

const DSCR_LENDERS: LenderProgram[] = [
  {
    id: 'verus_dscr',
    lender: 'Verus',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 100,
    role: 'Structured DSCR — best for clean deals',
    min_credit: 680,
    min_dscr: 1.0,
    max_ltv: 80,
    min_loan_amount: 150000,
    max_loan_amount: 3000000,
    no_minimum_loan: false,
    no_seasoning_supported: false,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: true,
    foreign_national_allowed: false,
    rural_allowed: false,
    recently_rehabbed_allowed: true,
  },
  {
    id: 'uwm_dscr',
    lender: 'UWM',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 92,
    role: 'Speed — fast closing, no minimum loan',
    min_credit: 700,
    min_dscr: 1.0,
    max_ltv: 75,
    no_minimum_loan: true,
    max_loan_amount: 2500000,
    no_seasoning_supported: false,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: true,
    recently_rehabbed_allowed: false,
  },
  {
    id: 'ahl_funding_dscr',
    lender: 'AHL Funding',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 88,
    role: 'No-seasoning rehab specialist',
    min_credit: 660,
    min_dscr: 1.0,
    max_ltv: 75,
    min_loan_amount: 100000,
    max_loan_amount: 2000000,
    no_minimum_loan: false,
    no_seasoning_supported: true,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: false,
    recently_rehabbed_allowed: true,
  },
  {
    id: 'champions_dscr',
    lender: 'Champions Funding',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 86,
    role: 'No-seasoning alternative',
    min_credit: 680,
    min_dscr: 1.0,
    max_ltv: 75,
    min_loan_amount: 100000,
    max_loan_amount: 2000000,
    no_minimum_loan: false,
    no_seasoning_supported: true,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: false,
    recently_rehabbed_allowed: false,
  },
  {
    id: 'brokers_advantage_dscr',
    lender: 'Brokers Advantage',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 82,
    role: 'Rural or lower credit specialist',
    min_credit: 640,
    min_dscr: 0.9,
    max_ltv: 70,
    min_loan_amount: 75000,
    max_loan_amount: 1500000,
    no_minimum_loan: false,
    no_seasoning_supported: false,
    low_credit_supported: true,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: true,
    recently_rehabbed_allowed: false,
  },
  {
    id: 'constructive_capital_dscr',
    lender: 'Constructive Capital',
    program: 'DSCR / Bridge',
    loan_type: 'DSCR',
    priority: 84,
    role: 'Edge cases — low credit, high leverage, workaround states',
    min_credit: 620,
    min_dscr: 0.75,
    max_ltv: 75,
    min_loan_amount: 100000,
    max_loan_amount: 5000000,
    no_minimum_loan: false,
    no_seasoning_supported: true,
    low_credit_supported: true,
    high_leverage_supported: true,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: true,
    recently_rehabbed_allowed: true,
  },
  {
    id: 'cv3_dscr',
    lender: 'CV3',
    program: 'DSCR',
    loan_type: 'DSCR',
    priority: 65,
    role: 'Fallback lender — handles leftovers',
    min_credit: 620,
    min_dscr: 0.75,
    max_ltv: 65,
    min_loan_amount: 75000,
    max_loan_amount: 2000000,
    no_minimum_loan: false,
    no_seasoning_supported: true,
    low_credit_supported: true,
    high_leverage_supported: false,
    short_term_rental_allowed: true,
    foreign_national_allowed: true,
    rural_allowed: true,
    recently_rehabbed_allowed: true,
  },
];

const NQM_LENDERS: LenderProgram[] = [
  {
    id: 'nqm_funding_nqm',
    lender: 'NQM Funding',
    program: 'Bank Statement / WVOE',
    loan_type: 'NQM',
    priority: 100,
    role: 'Baseline NQM — Flex Supreme/Select programs',
    min_credit: 660,
    max_ltv: 80,
    min_loan_amount: 100000,
    max_loan_amount: 3000000,
    no_minimum_loan: false,
    no_seasoning_supported: false,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: false,
    recently_rehabbed_allowed: false,
  },
  {
    id: 'uwm_nqm',
    lender: 'UWM',
    program: 'Non-QM Bank Statement',
    loan_type: 'NQM',
    priority: 90,
    role: 'Speed — fast closing, no minimum loan',
    min_credit: 680,
    max_ltv: 75,
    no_minimum_loan: true,
    max_loan_amount: 2500000,
    no_seasoning_supported: false,
    low_credit_supported: false,
    high_leverage_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: true,
    recently_rehabbed_allowed: false,
  },
  {
    id: 'constructive_capital_nqm',
    lender: 'Constructive Capital',
    program: 'Non-QM',
    loan_type: 'NQM',
    priority: 84,
    role: 'Edge cases — complex income, workaround states',
    min_credit: 620,
    max_ltv: 70,
    min_loan_amount: 100000,
    max_loan_amount: 5000000,
    no_minimum_loan: false,
    no_seasoning_supported: true,
    low_credit_supported: true,
    high_leverage_supported: true,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    rural_allowed: true,
    recently_rehabbed_allowed: true,
  },
];

function isNearLoanMinimum(loanAmount: number, minLoanAmount: number): boolean {
  return loanAmount < minLoanAmount && loanAmount >= minLoanAmount * 0.95;
}

function isMaterialLoanFail(loanAmount: number, minLoanAmount: number): boolean {
  return loanAmount < minLoanAmount * 0.95;
}

function isNearCredit(creditScore: number, minCredit: number, friendly: boolean): boolean {
  const buffer = friendly ? 20 : 10;
  return creditScore < minCredit && creditScore >= minCredit - buffer;
}

function isMaterialCreditFail(creditScore: number, minCredit: number, friendly: boolean): boolean {
  const buffer = friendly ? 20 : 10;
  return creditScore < minCredit - buffer;
}

function isNearLtv(ltv: number, maxLtv: number, friendly: boolean): boolean {
  const buffer = friendly ? 5 : 2;
  return ltv > maxLtv && ltv <= maxLtv + buffer;
}

function isNearDscr(dscr: number, minDscr: number): boolean {
  return dscr < minDscr && dscr >= minDscr - 0.05;
}

function generateSalvageSuggestions(
  program: LenderProgram,
  profile: BorrowerProfile,
  hardStops: string[],
  nearMisses: string[],
  dscr: number | null,
  ltv: number
): SalvageSuggestion[] {
  const suggestions: SalvageSuggestion[] = [];
  const loanAmount = profile.loan_request.loan_amount;
  const propertyValue = ltv > 0 ? loanAmount / (ltv / 100) : 0;
  const creditScore = profile.credit_score ?? 0;

  for (const miss of nearMisses) {
    if (miss.toLowerCase().includes('loan amount') && program.min_loan_amount) {
      const shortfall = program.min_loan_amount - loanAmount;
      suggestions.push({
        field: 'Loan Amount',
        current_value: `$${loanAmount.toLocaleString()}`,
        required_value: `$${program.min_loan_amount.toLocaleString()}`,
        fix: `Increase loan amount by $${shortfall.toLocaleString()} to meet minimum`,
      });
    }

    if (miss.toLowerCase().includes('credit') && program.min_credit) {
      const gap = program.min_credit - creditScore;
      suggestions.push({
        field: 'Credit Score',
        current_value: `${creditScore}`,
        required_value: `${program.min_credit}`,
        fix: gap <= 15
          ? `Consider rapid rescore to gain ${gap} points`
          : `Credit improvement or add co-borrower with higher score`,
      });
    }

    if (miss.toLowerCase().includes('ltv') && program.max_ltv && propertyValue > 0) {
      const maxLoan = propertyValue * (program.max_ltv / 100);
      const reduction = Math.ceil(loanAmount - maxLoan);
      suggestions.push({
        field: 'LTV',
        current_value: `${ltv.toFixed(1)}%`,
        required_value: `${program.max_ltv}%`,
        fix: `Reduce loan by $${reduction.toLocaleString()} or increase down payment`,
      });
    }

    if (miss.toLowerCase().includes('dscr') && program.min_dscr && dscr != null) {
      const pitia = profile.income_profile.pitia ?? 0;
      const requiredRent = pitia * program.min_dscr;
      const currentRent = profile.income_profile.monthly_rent ?? 0;
      const rentGap = Math.ceil(requiredRent - currentRent);
      suggestions.push({
        field: 'DSCR',
        current_value: dscr.toFixed(2),
        required_value: program.min_dscr.toFixed(2),
        fix: rentGap > 0 && rentGap < 500
          ? `Increase rent by $${rentGap}/mo or reduce loan amount`
          : `Restructure to improve cash flow ratio`,
      });
    }
  }

  for (const stop of hardStops) {
    if (stop.toLowerCase().includes('loan amount') && program.min_loan_amount && suggestions.every(s => s.field !== 'Loan Amount')) {
      suggestions.push({
        field: 'Loan Amount',
        current_value: `$${loanAmount.toLocaleString()}`,
        required_value: `$${program.min_loan_amount.toLocaleString()}`,
        fix: `Loan significantly below minimum — consider alternative lender or larger property`,
      });
    }
  }

  return suggestions;
}

function applyDynamicBoosts(
  program: LenderProgram,
  profile: BorrowerProfile,
  baseScore: number
): number {
  let score = baseScore;
  const seasoningMonths = profile.property_profile.seasoning_months ?? 12;
  const creditScore = profile.credit_score ?? 999;

  if (profile.property_profile.recently_rehabbed && seasoningMonths < 6) {
    if (program.id === 'ahl_funding_dscr') score += 15;
    else if (program.id === 'constructive_capital_dscr') score += 10;
  }

  if (creditScore < 720 && creditScore >= 640 && program.low_credit_supported) {
    score += 10;
  }

  if (creditScore < 640 && program.low_credit_supported) {
    score += 12;
  }

  if (profile.borrower_flags.needs_speed && program.lender === 'UWM') {
    score += 15;
  }

  if (profile.property_location.is_rural && program.rural_allowed) {
    if (program.id === 'brokers_advantage_dscr') score += 10;
    else score += 5;
  }

  if (profile.property_profile.short_term_rental && program.short_term_rental_allowed) {
    score += 10;
  }

  if (profile.borrower_flags.foreign_national && program.foreign_national_allowed) {
    score += 15;
  }

  if (seasoningMonths < 6 && program.no_seasoning_supported) {
    score += 10;
  }

  return score;
}

function generateKeyInsight(
  fitCategory: FitCategory,
  hardStops: string[],
  nearMisses: string[]
): string {
  if (fitCategory === 'strong_fit') {
    return 'Fully eligible - no structural issues identified';
  }
  if (fitCategory === 'good_fit') {
    return 'Eligible with minor considerations';
  }
  if (fitCategory === 'conditional_fit') {
    return 'Eligible pending documentation verification';
  }
  if (fitCategory === 'closest_option') {
    const allIssues = [...hardStops, ...nearMisses];
    const hasLtvIssue = allIssues.some(r => r.toLowerCase().includes('ltv'));
    const hasLoanAmountIssue = allIssues.some(r => r.toLowerCase().includes('loan amount'));
    const hasCreditIssue = allIssues.some(r => r.toLowerCase().includes('credit'));
    const hasDscrIssue = allIssues.some(r => r.toLowerCase().includes('dscr'));
    if (hasLtvIssue) return 'High leverage relative to this lender\'s limits';
    if (hasLoanAmountIssue) return 'Loan amount near minimum threshold';
    if (hasCreditIssue) return 'Credit score below preferred range';
    if (hasDscrIssue) return 'DSCR below preferred threshold';
    return 'Minor constraints relative to program guidelines';
  }
  return 'Does not meet core program requirements';
}

function evaluateLender(
  program: LenderProgram,
  profile: BorrowerProfile,
  dscr: number | null
): LenderPlacementResult {
  const advantages: string[] = [];
  const hardStops: string[] = [];
  const nearMisses: string[] = [];
  let score = 50;

  const creditScore = profile.credit_score ?? 0;
  const ltv = profile.loan_request.ltv;
  const loanAmount = profile.loan_request.loan_amount;

  if (program.min_credit != null && creditScore > 0) {
    if (creditScore >= program.min_credit) {
      advantages.push(`Credit score ${creditScore} meets minimum ${program.min_credit}`);
      score += 10;
    } else if (isNearCredit(creditScore, program.min_credit, program.low_credit_supported)) {
      nearMisses.push(`Credit score ${creditScore} is near minimum ${program.min_credit}`);
      score += 3;
    } else if (isMaterialCreditFail(creditScore, program.min_credit, program.low_credit_supported)) {
      hardStops.push(`Credit score ${creditScore} below minimum ${program.min_credit}`);
      score -= 15;
    }
  }

  if (program.max_ltv != null && ltv > 0) {
    if (ltv <= program.max_ltv) {
      advantages.push(`LTV ${ltv.toFixed(1)}% within maximum ${program.max_ltv}%`);
      score += 10;
    } else if (isNearLtv(ltv, program.max_ltv, program.high_leverage_supported)) {
      nearMisses.push(`LTV ${ltv.toFixed(1)}% is near maximum ${program.max_ltv}%`);
      score += 2;
    } else {
      hardStops.push(`LTV ${ltv.toFixed(1)}% exceeds maximum ${program.max_ltv}%`);
      score -= 15;
    }
  }

  if (program.min_dscr != null && dscr != null) {
    if (dscr >= program.min_dscr) {
      advantages.push(`DSCR ${dscr.toFixed(2)} meets minimum ${program.min_dscr}`);
      score += 10;
    } else if (isNearDscr(dscr, program.min_dscr)) {
      nearMisses.push(`DSCR ${dscr.toFixed(2)} is near minimum ${program.min_dscr}`);
      score += 2;
    } else {
      hardStops.push(`DSCR ${dscr.toFixed(2)} below minimum ${program.min_dscr}`);
      score -= 15;
    }
  }

  if (!program.no_minimum_loan && program.min_loan_amount != null && loanAmount > 0) {
    if (loanAmount >= program.min_loan_amount) {
      advantages.push(`Loan $${loanAmount.toLocaleString()} meets minimum $${program.min_loan_amount.toLocaleString()}`);
      score += 8;
    } else if (isNearLoanMinimum(loanAmount, program.min_loan_amount)) {
      nearMisses.push(`Loan amount $${loanAmount.toLocaleString()} is slightly below minimum $${program.min_loan_amount.toLocaleString()}`);
      score += 3;
    } else if (isMaterialLoanFail(loanAmount, program.min_loan_amount)) {
      hardStops.push(`Loan amount $${loanAmount.toLocaleString()} below minimum $${program.min_loan_amount.toLocaleString()}`);
      score -= 12;
    }
  } else if (program.no_minimum_loan) {
    advantages.push(`No stated minimum loan amount`);
    score += 6;
  }

  if (program.max_loan_amount && loanAmount > program.max_loan_amount) {
    hardStops.push(`Loan $${loanAmount.toLocaleString()} exceeds maximum $${program.max_loan_amount.toLocaleString()}`);
    score -= 10;
  }

  const seasoningMonths = profile.property_profile.seasoning_months ?? 12;
  if (seasoningMonths < 6) {
    if (program.no_seasoning_supported) {
      advantages.push(`Accepts no-seasoning deals`);
      score += 10;
    } else {
      hardStops.push(`Seasoning ${seasoningMonths} months — lender requires 6+ months`);
    }
  }

  if (profile.property_profile.recently_rehabbed) {
    if (program.recently_rehabbed_allowed) {
      advantages.push(`Accepts recently rehabbed properties`);
      score += 5;
    } else {
      nearMisses.push(`Recently rehabbed — may require additional documentation`);
    }
  }

  if (profile.property_profile.short_term_rental) {
    if (program.short_term_rental_allowed) {
      advantages.push(`Accepts short-term rentals`);
      score += 5;
    } else {
      hardStops.push(`Short-term rental not allowed`);
    }
  }

  if (profile.borrower_flags.foreign_national) {
    if (program.foreign_national_allowed) {
      advantages.push(`Accepts foreign nationals`);
      score += 5;
    } else {
      hardStops.push(`Foreign national not allowed`);
    }
  }

  if (profile.property_location.is_rural) {
    if (program.rural_allowed) {
      advantages.push(`Accepts rural properties`);
      score += 5;
    } else {
      hardStops.push(`Rural property not allowed`);
    }
  }

  score = applyDynamicBoosts(program, profile, score);

  const eligible = hardStops.length === 0;
  let fitCategory: FitCategory;

  if (eligible && nearMisses.length === 0) {
    fitCategory = 'strong_fit';
  } else if (eligible && nearMisses.length === 1) {
    fitCategory = 'good_fit';
  } else if (eligible && nearMisses.length >= 2) {
    fitCategory = 'conditional_fit';
  } else if (!eligible && hardStops.length === 1 && nearMisses.length <= 2) {
    fitCategory = 'closest_option';
  } else {
    fitCategory = 'no_fit';
  }

  const salvageSuggestions = (hardStops.length > 0 || nearMisses.length > 0)
    ? generateSalvageSuggestions(program, profile, hardStops, nearMisses, dscr, ltv)
    : [];

  let finalScore = Math.max(0, Math.min(100, score));
  if (fitCategory === 'strong_fit') {
    finalScore = Math.max(75, Math.min(90, finalScore));
  } else if (fitCategory === 'good_fit') {
    finalScore = Math.max(65, Math.min(80, finalScore));
  } else if (fitCategory === 'conditional_fit') {
    finalScore = Math.max(55, Math.min(70, finalScore));
  } else if (fitCategory === 'closest_option') {
    finalScore = Math.max(45, Math.min(65, finalScore));
  } else {
    finalScore = Math.max(0, Math.min(45, finalScore));
  }

  const keyInsight = generateKeyInsight(fitCategory, hardStops, nearMisses);

  return {
    program,
    score: finalScore,
    fit_category: fitCategory,
    eligible,
    blocking_reasons: hardStops,
    passing_criteria: advantages,
    strategy_reason: program.role,
    qualification_gaps: nearMisses,
    salvage_suggestions: salvageSuggestions,
    indicative_rate: null,
    key_insight: keyInsight,
  };
}

function evaluateLenderForNQM(
  program: LenderProgram,
  profile: BorrowerProfile,
  nqmResult: NQMEngineResult
): LenderPlacementResult {
  const result = evaluateLender(program, profile, null);

  if (nqmResult.income_method === 'bank_statement') {
    result.passing_criteria.push('Income estimated from average monthly deposits (subject to full documentation review)');
    result.score += 5;
  }

  return result;
}

export function runLenderPlacement(
  loanType: LoanType,
  profile: BorrowerProfile,
  dscrResult: DSCREngineResult | null,
  nqmResult: NQMEngineResult | null
): LenderPlacementResult[] {
  const results: LenderPlacementResult[] = [];

  if (loanType === 'DSCR' && dscrResult) {
    const dscr = dscrResult.dscr ?? null;
    for (const program of DSCR_LENDERS) {
      results.push(evaluateLender(program, profile, dscr));
    }
  } else if (loanType === 'NQM' && nqmResult) {
    for (const program of NQM_LENDERS) {
      results.push(evaluateLenderForNQM(program, profile, nqmResult));
    }
  }

  results.sort((a, b) => b.score - a.score);

  const eligibleCount = results.filter(r => r.eligible).length;
  if (eligibleCount === 0 && results.length > 0) {
    const closestOptions = results.slice(0, 3);
    for (const option of closestOptions) {
      if (option.fit_category === 'no_fit' && option.blocking_reasons.length <= 2) {
        option.fit_category = 'closest_option';
        option.key_insight = generateKeyInsight(option.fit_category, option.blocking_reasons, option.qualification_gaps);
      }
    }
  }

  return results;
}

export function evaluateLoanAmount(
  loanAmount: number,
  minLoanAmount: number | undefined
): { status: 'meets' | 'near_threshold' | 'fails'; message: string } {
  if (!minLoanAmount) {
    return { status: 'meets', message: 'No minimum loan amount requirement' };
  }

  if (loanAmount >= minLoanAmount) {
    return {
      status: 'meets',
      message: `Loan $${loanAmount.toLocaleString()} meets minimum $${minLoanAmount.toLocaleString()}`,
    };
  }

  if (isNearLoanMinimum(loanAmount, minLoanAmount)) {
    const shortfall = minLoanAmount - loanAmount;
    return {
      status: 'near_threshold',
      message: `Loan $${loanAmount.toLocaleString()} is $${shortfall.toLocaleString()} below minimum — may be structurable`,
    };
  }

  return {
    status: 'fails',
    message: `Loan $${loanAmount.toLocaleString()} below minimum $${minLoanAmount.toLocaleString()}`,
  };
}

export { DSCR_LENDERS, NQM_LENDERS, BASE_PROGRAM_RULES };
