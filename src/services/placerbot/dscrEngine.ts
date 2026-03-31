import type { BorrowerProfile } from './loanTypeRouter';

export interface DSCREngineResult {
  dscr: number | null;
  credit_tier: DSCRTier | null;
  qualifying_rent: number | null;
  pitia: number | null;
  max_ltv: number | null;
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  warnings: string[];
  rent_method_used: 'lease' | 'market' | 'average_str' | null;
}

export interface DSCRTier {
  tier: string;
  min_credit: number;
  min_dscr: number;
  max_ltv: number;
  risk: 'low' | 'moderate' | 'elevated' | 'high';
}

const DSCR_MATRIX_TIERS: DSCRTier[] = [
  { tier: 'tier_1', min_credit: 720, min_dscr: 1.25, max_ltv: 80, risk: 'low' },
  { tier: 'tier_2', min_credit: 700, min_dscr: 1.15, max_ltv: 75, risk: 'moderate' },
  { tier: 'tier_3', min_credit: 680, min_dscr: 1.0, max_ltv: 70, risk: 'elevated' },
  { tier: 'tier_4', min_credit: 660, min_dscr: 0.75, max_ltv: 65, risk: 'high' },
];

const MIN_CREDIT_FLOOR = 660;
const MIN_DSCR_FLOOR = 0.75;

function determineQualifyingRent(profile: BorrowerProfile): {
  rent: number | null;
  method: 'lease' | 'market' | 'average_str' | null;
  warnings: string[];
} {
  const { income_profile, property_profile } = profile;
  const warnings: string[] = [];

  if (property_profile.short_term_rental) {
    if (income_profile.monthly_rent != null) {
      return {
        rent: income_profile.monthly_rent * 0.8,
        method: 'average_str',
        warnings: ['Short-term rental uses 12-month average with 20% haircut applied'],
      };
    }
    return { rent: null, method: null, warnings: ['STR requires 12-month average rent history'] };
  }

  const leaseRent = income_profile.lease_rent;
  const marketRent = income_profile.market_rent;

  if (leaseRent != null && marketRent != null) {
    if (leaseRent > marketRent) {
      warnings.push('Lease rent exceeds market rent — requires 2 months receipt evidence');
      return { rent: leaseRent, method: 'lease', warnings };
    }
    return { rent: Math.max(leaseRent, marketRent), method: leaseRent >= marketRent ? 'lease' : 'market', warnings };
  }

  if (leaseRent != null) {
    return { rent: leaseRent, method: 'lease', warnings };
  }

  if (marketRent != null) {
    return { rent: marketRent, method: 'market', warnings };
  }

  if (income_profile.monthly_rent != null) {
    return { rent: income_profile.monthly_rent, method: 'market', warnings };
  }

  if (property_profile.recently_rehabbed && property_profile.listed_for_rent) {
    warnings.push('Recently constructed/rehabbed vacant property — allowed if listed for rent');
    return { rent: null, method: null, warnings };
  }

  return { rent: null, method: null, warnings };
}

function findBestTier(creditScore: number, dscr: number): DSCRTier | null {
  for (const tier of DSCR_MATRIX_TIERS) {
    if (creditScore >= tier.min_credit && dscr >= tier.min_dscr) {
      return tier;
    }
  }
  return null;
}

export function runDSCREngine(profile: BorrowerProfile): DSCREngineResult {
  const blockingReasons: string[] = [];
  const passingCriteria: string[] = [];
  const warnings: string[] = [];

  const creditScore = profile.credit_score;
  const pitia = profile.income_profile.pitia;

  if (creditScore == null) {
    blockingReasons.push('Credit score not provided');
  } else if (creditScore < MIN_CREDIT_FLOOR) {
    blockingReasons.push(`Credit score ${creditScore} below minimum ${MIN_CREDIT_FLOOR}`);
  } else {
    passingCriteria.push(`Credit score ${creditScore} meets DSCR minimum of ${MIN_CREDIT_FLOOR}`);
  }

  if (pitia == null || pitia <= 0) {
    blockingReasons.push('PITIA (monthly payment) not provided or invalid');
  }

  const rentResult = determineQualifyingRent(profile);
  warnings.push(...rentResult.warnings);

  if (rentResult.rent == null) {
    blockingReasons.push('Qualifying rent could not be determined');
  }

  const dscr = rentResult.rent != null && pitia != null && pitia > 0
    ? rentResult.rent / pitia
    : null;

  if (dscr != null) {
    if (dscr < MIN_DSCR_FLOOR) {
      blockingReasons.push(`DSCR ${dscr.toFixed(2)} below minimum ${MIN_DSCR_FLOOR}`);
    } else {
      passingCriteria.push(`DSCR ${dscr.toFixed(2)} meets program threshold`);
    }
  }

  if (profile.occupancy !== 'investment') {
    blockingReasons.push('DSCR loans require investment/rental property — owner-occupied not eligible');
  } else {
    passingCriteria.push('Investment property occupancy qualifies for DSCR');
  }

  if (profile.borrower_flags.foreign_national) {
    warnings.push('Foreign national — limited DSCR lenders available');
  }

  if (profile.borrower_flags.first_time_investor) {
    warnings.push('First-time investor — some lenders require minimum credit 680');
  }

  if ((profile.property_profile.seasoning_months ?? 12) < 6) {
    warnings.push('Property seasoning under 6 months — requires no-seasoning lender');
  }

  let creditTier: DSCRTier | null = null;
  let maxLtv: number | null = null;

  if (creditScore != null && dscr != null && blockingReasons.length === 0) {
    creditTier = findBestTier(creditScore, dscr);
    if (creditTier) {
      maxLtv = creditTier.max_ltv;
      passingCriteria.push(`Qualifies for ${creditTier.tier} (${creditTier.risk} risk) with max LTV ${maxLtv}%`);

      if (profile.loan_request.ltv > maxLtv) {
        blockingReasons.push(`Requested LTV ${profile.loan_request.ltv.toFixed(1)}% exceeds max ${maxLtv}% for credit/DSCR tier`);
      } else {
        passingCriteria.push(`LTV ${profile.loan_request.ltv.toFixed(1)}% within allowed ${maxLtv}%`);
      }
    } else {
      blockingReasons.push('No eligible tier found for credit score and DSCR combination');
    }
  }

  return {
    dscr,
    credit_tier: creditTier,
    qualifying_rent: rentResult.rent,
    pitia,
    max_ltv: maxLtv,
    eligible: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    passing_criteria: passingCriteria,
    warnings,
    rent_method_used: rentResult.method,
  };
}
