export type BorrowerLoanType = 'dscr' | 'fix_flip' | 'bank_statement' | 'not_sure';

export interface DocumentRequirement {
  type: string;
  label: string;
  required: boolean;
  preferred?: string;
}

export interface LiquidityRule {
  multiplier: number;
  basis: 'monthly_payment' | 'loan_amount' | 'purchase_price';
  description: string;
}

export interface LoanTypeConfig {
  loanType: BorrowerLoanType;
  label: string;
  description: string;
  documents: DocumentRequirement[];
  liquidityRule: LiquidityRule;
  preApprovalNote: string;
}

export const LOAN_TYPE_DOCUMENT_CONFIG: Record<BorrowerLoanType, LoanTypeConfig> = {
  dscr: {
    loanType: 'dscr',
    label: 'DSCR',
    description: 'Investment property loan based on rental income',
    documents: [
      { type: 'bank_statement', label: 'Bank Statements', required: true, preferred: '12 months preferred' },
      { type: 'proof_of_liquidity', label: 'Proof of Liquidity/Reserves', required: true },
      { type: 'entity_docs', label: 'Entity Documents (if LLC)', required: false },
      { type: 'brokerage_statement', label: 'Brokerage Statements', required: false },
    ],
    liquidityRule: {
      multiplier: 4,
      basis: 'monthly_payment',
      description: 'of estimated monthly payment in reserves',
    },
    preApprovalNote: 'Upload bank statements to verify you have at least 4x the estimated monthly payment in liquid reserves.',
  },

  fix_flip: {
    loanType: 'fix_flip',
    label: 'Fix & Flip',
    description: 'Short-term renovation and resale financing',
    documents: [
      { type: 'bank_statement', label: 'Bank Statements', required: true, preferred: '12 months preferred' },
      { type: 'proof_of_funds', label: 'Proof of Funds', required: true },
      { type: 'rehab_budget', label: 'Rehab Budget (if available)', required: false },
      { type: 'entity_docs', label: 'Entity Documents (if LLC)', required: false },
    ],
    liquidityRule: {
      multiplier: 10,
      basis: 'purchase_price',
      description: 'of purchase price in liquid funds',
    },
    preApprovalNote: 'Upload proof of liquidity/funds needed for reserve review. We need to verify you have at least 10% of the purchase price in liquid funds.',
  },

  bank_statement: {
    loanType: 'bank_statement',
    label: 'Bank Statement',
    description: 'Self-employed borrower loan using bank deposits',
    documents: [
      { type: 'bank_statement', label: 'Bank Statements', required: true, preferred: '12-24 months preferred' },
      { type: 'proof_of_liquidity', label: 'Proof of Liquidity/Reserves', required: true },
      { type: 'business_license', label: 'Business License', required: false },
      { type: 'profit_loss', label: 'Profit & Loss Statement', required: false },
    ],
    liquidityRule: {
      multiplier: 4,
      basis: 'monthly_payment',
      description: 'of estimated monthly payment in reserves',
    },
    preApprovalNote: 'Upload 12-24 months of bank statements to verify income and liquidity reserves.',
  },

  not_sure: {
    loanType: 'not_sure',
    label: 'Not Sure',
    description: 'Will be reviewed internally to determine best fit',
    documents: [
      { type: 'bank_statement', label: 'Bank Statements', required: true, preferred: '12 months preferred' },
      { type: 'proof_of_liquidity', label: 'Proof of Liquidity', required: false },
    ],
    liquidityRule: {
      multiplier: 4,
      basis: 'monthly_payment',
      description: 'of estimated monthly payment in reserves',
    },
    preApprovalNote: 'Upload your bank statements and we will help determine the best loan type for your situation.',
  },
};

export function getLoanTypeConfig(loanType: BorrowerLoanType | string | null | undefined): LoanTypeConfig {
  if (!loanType || !(loanType in LOAN_TYPE_DOCUMENT_CONFIG)) {
    return LOAN_TYPE_DOCUMENT_CONFIG.not_sure;
  }
  return LOAN_TYPE_DOCUMENT_CONFIG[loanType as BorrowerLoanType];
}

export function getRequiredDocuments(loanType: BorrowerLoanType): DocumentRequirement[] {
  const config = getLoanTypeConfig(loanType);
  return config.documents.filter(d => d.required);
}

export function getOptionalDocuments(loanType: BorrowerLoanType): DocumentRequirement[] {
  const config = getLoanTypeConfig(loanType);
  return config.documents.filter(d => !d.required);
}
