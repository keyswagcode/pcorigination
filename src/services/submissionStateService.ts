import { supabase } from '../lib/supabase';

export interface SubmissionDocument {
  id: string;
  file_name: string;
  processing_status: string | null;
}

export interface SubmissionBankAccount {
  id: string;
  bank_name: string | null;
  closing_balance: number | null;
  available_cash: number | null;
  total_deposits: number | null;
}

export interface SubmissionState {
  documents: SubmissionDocument[];
  bankAccounts: SubmissionBankAccount[];
  preApprovalResult: { status: string; sub_status?: string } | null;
  loanAmount: number;
}

export async function getSubmissionState(submissionId: string): Promise<SubmissionState> {
  const [
    { data: documents },
    { data: bankAccounts },
    { data: preApproval },
    { data: loanRequest },
  ] = await Promise.all([
    supabase
      .from('uploaded_documents')
      .select('id, file_name, processing_status')
      .eq('intake_submission_id', submissionId),

    supabase
      .from('bank_statement_accounts')
      .select('id, bank_name, closing_balance, available_cash, total_deposits')
      .eq('intake_submission_id', submissionId),

    supabase
      .from('pre_approvals')
      .select('status, passes_liquidity_check')
      .eq('intake_submission_id', submissionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from('loan_requests')
      .select('requested_amount')
      .eq('intake_submission_id', submissionId)
      .maybeSingle(),
  ]);

  let preApprovalResult: { status: string; sub_status?: string } | null = null;
  if (preApproval) {
    const subStatus = preApproval.passes_liquidity_check ? 'pre_approved' : 'liquidity_review_required';
    preApprovalResult = {
      status: preApproval.status,
      sub_status: subStatus,
    };
  }

  return {
    documents: (documents || []) as SubmissionDocument[],
    bankAccounts: (bankAccounts || []) as SubmissionBankAccount[],
    preApprovalResult,
    loanAmount: loanRequest?.requested_amount || 0,
  };
}

export async function getDocumentsForSubmission(submissionId: string): Promise<SubmissionDocument[]> {
  const { data } = await supabase
    .from('uploaded_documents')
    .select('id, file_name, processing_status')
    .eq('intake_submission_id', submissionId);

  return (data || []) as SubmissionDocument[];
}
