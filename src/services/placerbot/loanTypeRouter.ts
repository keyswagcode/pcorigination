export type LoanType = 'DSCR' | 'NQM' | 'MANUAL_REVIEW';
export type QualificationPreference = 'auto' | 'dscr' | 'income';

export interface BorrowerProfile {
  credit_score: number | null;
  occupancy: 'investment' | 'primary' | 'second_home';
  property_type: string | null;
  property_location: {
    state: string | null;
    county: string | null;
    is_rural: boolean;
  };
  loan_request: {
    loan_amount: number;
    ltv: number;
    purpose: 'purchase' | 'rate_term_refinance' | 'cash_out_refinance';
    cash_out: boolean;
  };
  income_profile: {
    monthly_rent: number | null;
    market_rent: number | null;
    lease_rent: number | null;
    pitia: number | null;
    has_rental_income: boolean;
    has_w2_income: boolean;
    has_self_employed_income: boolean;
    bank_statement_months: number | null;
    total_bank_deposits: number | null;
    ownership_percentage: number;
    nsf_count_recent: number;
  };
  property_profile: {
    seasoning_months: number | null;
    recently_rehabbed: boolean;
    listed_for_rent: boolean;
    short_term_rental: boolean;
  };
  borrower_flags: {
    foreign_national: boolean;
    itin: boolean;
    first_time_investor: boolean;
    needs_speed: boolean;
  };
  assets: {
    liquid_reserves: number;
  };
  qualification_preference?: QualificationPreference;
}

export interface RouterResult {
  recommended_loan_type: LoanType;
  routing_reason: string;
  alternate_loan_type: LoanType | null;
  alternate_reason: string | null;
}

export function routeLoanType(profile: BorrowerProfile): RouterResult {
  const { occupancy, income_profile, qualification_preference } = profile;

  const hasPersonalIncome = income_profile.has_w2_income ||
    income_profile.has_self_employed_income ||
    (income_profile.bank_statement_months != null && income_profile.bank_statement_months > 0) ||
    (income_profile.total_bank_deposits ?? 0) > 0;

  const canQualifyDSCR = occupancy === 'investment' && income_profile.has_rental_income;
  const canQualifyNQM = hasPersonalIncome;

  if (qualification_preference === 'dscr') {
    if (canQualifyDSCR) {
      return {
        recommended_loan_type: 'DSCR',
        routing_reason: 'User selected DSCR — qualifying via property rental income',
        alternate_loan_type: canQualifyNQM ? 'NQM' : null,
        alternate_reason: canQualifyNQM ? 'Can also qualify using personal income (NQM)' : null,
      };
    }
    return {
      recommended_loan_type: 'MANUAL_REVIEW',
      routing_reason: 'DSCR requested but property is not investment or lacks rental income',
      alternate_loan_type: canQualifyNQM ? 'NQM' : null,
      alternate_reason: canQualifyNQM ? 'Consider NQM using personal income instead' : null,
    };
  }

  if (qualification_preference === 'income') {
    if (canQualifyNQM) {
      const method = income_profile.has_self_employed_income || (income_profile.total_bank_deposits ?? 0) > 0
        ? 'bank statement income'
        : 'W-2 income';
      return {
        recommended_loan_type: 'NQM',
        routing_reason: `User selected income qualification — using ${method}`,
        alternate_loan_type: canQualifyDSCR ? 'DSCR' : null,
        alternate_reason: canQualifyDSCR ? 'Can also qualify using rental income (DSCR)' : null,
      };
    }
    return {
      recommended_loan_type: 'MANUAL_REVIEW',
      routing_reason: 'Income qualification requested but no income documentation provided',
      alternate_loan_type: canQualifyDSCR ? 'DSCR' : null,
      alternate_reason: canQualifyDSCR ? 'Consider DSCR using rental income instead' : null,
    };
  }

  if (hasPersonalIncome) {
    const method = income_profile.has_self_employed_income || (income_profile.total_bank_deposits ?? 0) > 0
      ? 'Bank statement'
      : 'W-2';
    return {
      recommended_loan_type: 'NQM',
      routing_reason: `Borrower has personal income documentation — ${method} NQM program`,
      alternate_loan_type: canQualifyDSCR ? 'DSCR' : null,
      alternate_reason: canQualifyDSCR
        ? 'Investment property may also qualify for DSCR if rental income covers debt service'
        : null,
    };
  }

  if (canQualifyDSCR) {
    return {
      recommended_loan_type: 'DSCR',
      routing_reason: 'Investment property with rental income — no personal income needed',
      alternate_loan_type: null,
      alternate_reason: null,
    };
  }

  return {
    recommended_loan_type: 'MANUAL_REVIEW',
    routing_reason: 'No qualifying income source identified — manual underwriting required',
    alternate_loan_type: null,
    alternate_reason: null,
  };
}
