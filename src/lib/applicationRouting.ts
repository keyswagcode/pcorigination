export type ApplicationStep = 'loan_info' | 'upload' | 'processing' | 'liquidity_check' | 'result';

export interface BankAccountData {
  bank_name?: string | null;
  closing_balance?: number | null;
  available_cash?: number | null;
  total_deposits?: number | null;
}

export interface DocumentData {
  id: string;
  processing_status?: string | null;
  extraction_status?: string | null;
}

export interface ResolveStepParams {
  documents: DocumentData[];
  bankAccounts: BankAccountData[];
  loanAmount: number;
  hasPreApproval?: boolean;
}

export function isDocumentProcessed(status?: string | null): boolean {
  return ['completed', 'processed', 'documents_processed', 'complete', 'success', 'done'].includes((status || '').toLowerCase());
}

export function isDocumentProcessing(status?: string | null): boolean {
  return ['pending', 'processing', 'queued', 'documents_processing'].includes((status || '').toLowerCase());
}

export function isDocumentFailed(status?: string | null): boolean {
  return ['failed', 'error'].includes((status || '').toLowerCase());
}

export function isValidBankAccount(acc: BankAccountData): boolean {
  if (!acc.bank_name || acc.bank_name === 'Unknown Bank' || acc.bank_name === 'Unknown') {
    return false;
  }
  const balance = parseFloat(String(acc.closing_balance)) || parseFloat(String(acc.available_cash)) || 0;
  const deposits = parseFloat(String(acc.total_deposits)) || 0;
  return balance > 0 || deposits > 0;
}

export function resolveApplicationStep(params: ResolveStepParams): ApplicationStep {
  const { documents, loanAmount, hasPreApproval } = params;

  const hasLoanAmount = (loanAmount ?? 0) > 0;
  const hasDocuments = documents.length > 0;
  const hasAtLeastOneProcessed = documents.some(d => isDocumentProcessed(d.processing_status));
  const hasAnyProcessing = documents.some(d => isDocumentProcessing(d.processing_status));

  console.log('[lib/applicationRouting] ROUTING DEBUG:', {
    documentsCount: documents.length,
    hasDocuments,
    hasAtLeastOneProcessed,
    hasAnyProcessing,
    loanAmount,
    hasLoanAmount,
    hasPreApproval,
    docStatuses: documents.map(d => ({ id: d.id?.slice(0, 8), status: d.processing_status })),
  });

  if (hasPreApproval) {
    console.log('[lib/applicationRouting] -> result (has pre-approval)');
    return 'result';
  }

  if (hasAnyProcessing) {
    console.log('[lib/applicationRouting] -> upload (documents still processing)');
    return 'upload';
  }

  if (hasAtLeastOneProcessed && hasLoanAmount) {
    console.log('[lib/applicationRouting] -> liquidity_check (at least one processed doc + loan amount)');
    return 'liquidity_check';
  }

  if (hasDocuments) {
    console.log('[lib/applicationRouting] -> upload (documents exist but none processed yet)');
    return 'upload';
  }

  if (!hasLoanAmount) {
    console.log('[lib/applicationRouting] -> loan_info (no loan amount)');
    return 'loan_info';
  }

  console.log('[lib/applicationRouting] -> loan_info (default)');
  return 'loan_info';
}

export function getStepLabel(step: ApplicationStep): string {
  switch (step) {
    case 'loan_info':
      return 'Loan Information';
    case 'upload':
      return 'Document Upload';
    case 'processing':
      return 'Processing Documents';
    case 'liquidity_check':
      return 'Liquidity Verification';
    case 'result':
      return 'Pre-Approval Result';
    default:
      return 'Unknown';
  }
}

export function canProceedToLiquidity(params: Omit<ResolveStepParams, 'hasPreApproval'>): {
  canProceed: boolean;
  reason?: string;
} {
  const { documents, loanAmount } = params;

  if (!documents || documents.length === 0) {
    return { canProceed: false, reason: 'No documents uploaded' };
  }

  const hasAtLeastOneProcessed = documents.some(d => isDocumentProcessed(d.processing_status));
  if (!hasAtLeastOneProcessed) {
    return { canProceed: false, reason: 'Documents not yet processed' };
  }

  if (loanAmount <= 0) {
    return { canProceed: false, reason: 'Loan amount not specified' };
  }

  return { canProceed: true };
}
