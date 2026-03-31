export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function formatInputCurrency(value: string): string {
  const num = value.replace(/[^0-9]/g, '');
  if (!num) return '';
  return new Intl.NumberFormat('en-US').format(parseInt(num));
}

export function parseCurrency(value: string): number {
  return parseFloat(value.replace(/,/g, '')) || 0;
}

export function calculateRequiredLiquidity(loanAmount: number): number {
  const estimatedRate = 0.08;
  const termMonths = 360;
  if (loanAmount <= 0) return 0;
  const monthlyPayment =
    (loanAmount * (estimatedRate / 12) * Math.pow(1 + estimatedRate / 12, termMonths)) /
    (Math.pow(1 + estimatedRate / 12, termMonths) - 1);
  return monthlyPayment * 4;
}

export function calculateLTV(loanAmount: number, purchasePrice: number): number {
  if (!purchasePrice || purchasePrice <= 0) return 0;
  return (loanAmount / purchasePrice) * 100;
}

export interface BankAccountInput {
  id?: string;
  bank_name?: string | null;
  closing_balance?: number | null;
  available_cash?: number | null;
  total_deposits?: number | null;
}

export interface DocumentInput {
  id: string;
  processing_status?: string | null;
  extraction_status?: string | null;
}

export interface ResolveStageInput {
  documents: DocumentInput[];
  bankAccounts: BankAccountInput[];
  preApprovalResult: { status?: string; sub_status?: string } | null;
  processingStage?: string | null;
  sessionStorageKey?: string;
  loanAmount?: number;
}

export type ApplicationStepResolved =
  | 'loan-info'
  | 'property'
  | 'ownership'
  | 'documents'
  | 'liquidity'
  | 'pre-approval';

export type FlowStepResolved = 'loan_info' | 'upload' | 'liquidity_check' | 'result';

export function isValidBankAccount(acc: BankAccountInput): boolean {
  if (!acc.bank_name || acc.bank_name === 'Unknown Bank' || acc.bank_name === 'Unknown') {
    return false;
  }
  const balance = parseFloat(String(acc.closing_balance)) || parseFloat(String(acc.available_cash)) || 0;
  const deposits = parseFloat(String(acc.total_deposits)) || 0;
  return balance > 0 || deposits > 0;
}

export function isDocumentProcessed(status?: string | null): boolean {
  return ['completed', 'processed', 'documents_processed', 'complete', 'success', 'done'].includes((status || '').toLowerCase());
}

export function isDocumentProcessing(status?: string | null): boolean {
  return ['pending', 'processing', 'queued', 'documents_processing'].includes((status || '').toLowerCase());
}

export function isDocumentFailed(status?: string | null): boolean {
  return ['failed', 'error', 'rejected'].includes((status || '').toLowerCase());
}

export type DocumentStatus = 'uploading' | 'processing' | 'complete' | 'error';

export function mapDocumentStatus(processingStatus?: string | null): DocumentStatus {
  if (isDocumentProcessed(processingStatus)) return 'complete';
  if (isDocumentFailed(processingStatus)) return 'error';
  if (isDocumentProcessing(processingStatus)) return 'processing';
  return 'uploading';
}

export function resolveApplicationStep(input: ResolveStageInput): ApplicationStepResolved {
  const { documents, preApprovalResult, sessionStorageKey, loanAmount } = input;

  const hasLoanAmount = (loanAmount ?? 0) > 0;
  const hasDocuments = documents.length > 0;
  const hasAtLeastOneProcessed = documents.some(d => isDocumentProcessed(d.processing_status));
  const hasAnyProcessing = documents.some(d => isDocumentProcessing(d.processing_status));

  const subStatus = preApprovalResult?.sub_status;
  const isPreApproved = subStatus === 'pre_approved';

  console.log('[resolveApplicationStep] ROUTING DEBUG:', {
    documentsCount: documents.length,
    hasDocuments,
    hasAtLeastOneProcessed,
    hasAnyProcessing,
    loanAmount,
    hasLoanAmount,
    hasPreApproval: !!preApprovalResult?.status,
    subStatus,
    isPreApproved,
    docStatuses: documents.map(d => ({
      id: d.id?.slice(0, 8),
      status: d.processing_status,
    })),
  });

  console.log('ROUTING CHECK:', {
    sub_status: subStatus,
    canProceed: isPreApproved
  });

  if (preApprovalResult?.status && isPreApproved) {
    console.log('[resolveApplicationStep] -> pre-approval (pre_approved)');
    return 'pre-approval';
  }

  if (preApprovalResult?.status && !isPreApproved) {
    console.log('[resolveApplicationStep] -> liquidity (sub_status not pre_approved, blocking navigation)');
    return 'liquidity';
  }

  if (hasAnyProcessing) {
    console.log('[resolveApplicationStep] -> documents (documents still processing)');
    return 'documents';
  }

  if (hasAtLeastOneProcessed && hasLoanAmount) {
    console.log('[resolveApplicationStep] -> liquidity (at least one processed doc + loan amount)');
    return 'liquidity';
  }

  if (hasDocuments) {
    console.log('[resolveApplicationStep] -> documents (documents uploaded but none processed yet)');
    return 'documents';
  }

  const saved = sessionStorageKey ? sessionStorage.getItem(sessionStorageKey) : null;
  if (saved && ['loan-info', 'property', 'ownership', 'documents'].includes(saved)) {
    console.log('[resolveApplicationStep] -> ' + saved + ' (from session storage)');
    return saved as ApplicationStepResolved;
  }

  console.log('[resolveApplicationStep] -> loan-info (default)');
  return 'loan-info';
}

export function resolveFlowStep(input: ResolveStageInput): FlowStepResolved {
  const { documents, preApprovalResult, sessionStorageKey, loanAmount } = input;

  const hasLoanAmount = (loanAmount ?? 0) > 0;
  const hasDocuments = documents.length > 0;
  const hasAtLeastOneProcessed = documents.some(d => isDocumentProcessed(d.processing_status));
  const hasAnyProcessing = documents.some(d => isDocumentProcessing(d.processing_status));

  const subStatus = preApprovalResult?.sub_status;
  const isPreApproved = subStatus === 'pre_approved';

  console.log('[resolveFlowStep] ROUTING DEBUG:', {
    documentsCount: documents.length,
    hasDocuments,
    hasAtLeastOneProcessed,
    hasAnyProcessing,
    loanAmount,
    hasLoanAmount,
    hasPreApproval: !!preApprovalResult?.status,
    subStatus,
    isPreApproved,
    docStatuses: documents.map(d => ({
      id: d.id?.slice(0, 8),
      status: d.processing_status,
    })),
  });

  console.log('ROUTING CHECK:', {
    sub_status: subStatus,
    canProceed: isPreApproved
  });

  if (preApprovalResult?.status && isPreApproved) {
    console.log('[resolveFlowStep] -> result (pre_approved)');
    return 'result';
  }

  if (preApprovalResult?.status && !isPreApproved) {
    console.log('[resolveFlowStep] -> liquidity_check (sub_status not pre_approved, blocking navigation)');
    return 'liquidity_check';
  }

  if (hasAnyProcessing) {
    console.log('[resolveFlowStep] -> upload (documents still processing)');
    return 'upload';
  }

  if (hasAtLeastOneProcessed && hasLoanAmount) {
    console.log('[resolveFlowStep] -> liquidity_check (at least one processed doc + loan amount)');
    return 'liquidity_check';
  }

  if (hasDocuments) {
    console.log('[resolveFlowStep] -> upload (documents uploaded but none processed yet)');
    return 'upload';
  }

  const saved = sessionStorageKey ? sessionStorage.getItem(sessionStorageKey) : null;
  if (saved && ['loan_info', 'upload'].includes(saved)) {
    console.log('[resolveFlowStep] -> ' + saved + ' (from session)');
    return saved as FlowStepResolved;
  }

  console.log('[resolveFlowStep] -> loan_info (default)');
  return 'loan_info';
}
