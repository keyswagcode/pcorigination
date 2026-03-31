import type { LoanType } from './loanTypeRouter';

export interface FieldRequirement {
  field: string;
  label: string;
  required: boolean;
  group: 'property' | 'income' | 'borrower' | 'loan';
}

export interface LoanTypeConfig {
  loanType: LoanType;
  label: string;
  description: string;
  requiredFields: FieldRequirement[];
  optionalFields: FieldRequirement[];
  requiredDocuments: string[];
  optionalDocuments: string[];
}

export const DSCR_CONFIG: LoanTypeConfig = {
  loanType: 'DSCR',
  label: 'DSCR (Property Income)',
  description: 'Qualify using rental income from the property',
  requiredFields: [
    { field: 'property_value', label: 'Property Value', required: true, group: 'property' },
    { field: 'loan_amount', label: 'Loan Amount', required: true, group: 'loan' },
    { field: 'monthly_rent', label: 'Monthly Rent', required: true, group: 'income' },
    { field: 'credit_score', label: 'Credit Score', required: true, group: 'borrower' },
    { field: 'liquidity', label: 'Liquid Reserves', required: true, group: 'borrower' },
  ],
  optionalFields: [
    { field: 'monthly_payment', label: 'Monthly PITIA', required: false, group: 'loan' },
    { field: 'dscr', label: 'DSCR Ratio', required: false, group: 'income' },
    { field: 'seasoning_months', label: 'Seasoning (months)', required: false, group: 'property' },
    { field: 'state', label: 'State', required: false, group: 'property' },
  ],
  requiredDocuments: ['lease_agreement'],
  optionalDocuments: ['appraisal', 'bank_statements'],
};

export const NQM_CONFIG: LoanTypeConfig = {
  loanType: 'NQM',
  label: 'NQM (Personal Income)',
  description: 'Qualify using bank statements or W-2 income',
  requiredFields: [
    { field: 'property_value', label: 'Property Value', required: true, group: 'property' },
    { field: 'loan_amount', label: 'Loan Amount', required: true, group: 'loan' },
    { field: 'credit_score', label: 'Credit Score', required: true, group: 'borrower' },
    { field: 'total_bank_deposits', label: 'Monthly Bank Deposits', required: true, group: 'income' },
    { field: 'bank_statement_months', label: 'Months of Statements', required: true, group: 'income' },
  ],
  optionalFields: [
    { field: 'ownership_percentage', label: 'Ownership %', required: false, group: 'income' },
    { field: 'liquidity', label: 'Liquid Reserves', required: false, group: 'borrower' },
    { field: 'state', label: 'State', required: false, group: 'property' },
  ],
  requiredDocuments: ['bank_statements'],
  optionalDocuments: ['business_docs', 'cpa_letter'],
};

export const MANUAL_REVIEW_CONFIG: LoanTypeConfig = {
  loanType: 'MANUAL_REVIEW',
  label: 'Manual Review',
  description: 'Complex scenario requiring underwriter review',
  requiredFields: [
    { field: 'property_value', label: 'Property Value', required: true, group: 'property' },
    { field: 'loan_amount', label: 'Loan Amount', required: true, group: 'loan' },
    { field: 'credit_score', label: 'Credit Score', required: true, group: 'borrower' },
  ],
  optionalFields: [],
  requiredDocuments: [],
  optionalDocuments: [],
};

export function getConfigForLoanType(loanType: LoanType): LoanTypeConfig {
  switch (loanType) {
    case 'DSCR':
      return DSCR_CONFIG;
    case 'NQM':
      return NQM_CONFIG;
    case 'MANUAL_REVIEW':
      return MANUAL_REVIEW_CONFIG;
  }
}

export interface ValidationResult {
  valid: boolean;
  missingFields: string[];
  missingDocuments: string[];
}

export function validateForLoanType(
  loanType: LoanType,
  formData: Record<string, unknown>,
  uploadedDocTypes: string[] = []
): ValidationResult {
  const config = getConfigForLoanType(loanType);
  const missingFields: string[] = [];
  const missingDocuments: string[] = [];

  for (const field of config.requiredFields) {
    const value = formData[field.field];
    if (value == null || value === '' || (typeof value === 'number' && isNaN(value))) {
      missingFields.push(field.label);
    }
  }

  for (const doc of config.requiredDocuments) {
    if (!uploadedDocTypes.includes(doc)) {
      missingDocuments.push(doc);
    }
  }

  return {
    valid: missingFields.length === 0 && missingDocuments.length === 0,
    missingFields,
    missingDocuments,
  };
}
