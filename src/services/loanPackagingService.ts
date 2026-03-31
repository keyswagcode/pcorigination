import { supabase } from './supabaseClient';
import type { LoanPackage } from '../shared/types';

function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || annualRate <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export async function buildLoanPackage(
  submissionId: string,
  formData: {
    loanAmount: number;
    purchasePrice: number;
    loanType: string;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    borrowerType: 'individual' | 'entity';
    creditScore: number;
    estimatedDscr?: number;
    occupancyType?: string;
    transactionType?: string;
  }
): Promise<LoanPackage> {
  const [borrowerResult, propertyResult, docsResult, bankAccountsResult] = await Promise.all([
    supabase
      .from('intake_submissions')
      .select('borrower_id, borrowers(id, borrower_name, entity_type, email)')
      .eq('id', submissionId)
      .maybeSingle(),
    supabase
      .from('properties')
      .select('*')
      .eq('intake_submission_id', submissionId)
      .maybeSingle(),
    supabase
      .from('uploaded_documents')
      .select('id, document_type, processing_status')
      .eq('intake_submission_id', submissionId),
    supabase
      .from('bank_statement_accounts')
      .select('*')
      .eq('intake_submission_id', submissionId),
  ]);

  const borrower = borrowerResult.data?.borrowers as { id: string; borrower_name: string; entity_type: string } | null;
  const property = propertyResult.data;
  const documents = docsResult.data || [];
  const bankAccounts = bankAccountsResult.data || [];

  let totalCash = 0, totalClosing = 0, totalDeposits = 0, totalWithdrawals = 0;
  for (const acct of bankAccounts) {
    totalCash += parseFloat(acct.available_cash) || parseFloat(acct.closing_balance) || 0;
    totalClosing += parseFloat(acct.closing_balance) || 0;
    totalDeposits += parseFloat(acct.total_deposits) || 0;
    totalWithdrawals += parseFloat(acct.total_withdrawals) || 0;
  }

  const monthCount = Math.max(bankAccounts.length, 1);
  const avgDeposits = totalDeposits / monthCount;
  const avgWithdrawals = totalWithdrawals / monthCount;
  const ltv = formData.purchasePrice > 0 ? formData.loanAmount / formData.purchasePrice : 0;
  const monthlyPayment = calculateMonthlyPayment(formData.loanAmount, 0.08, 360);
  const requiredLiquidity = monthlyPayment * 4;

  return {
    submission_id: submissionId,
    borrower_profile: {
      borrower_id: borrower?.id || '',
      borrower_name: borrower?.borrower_name || '',
      entity_type: borrower?.entity_type || formData.borrowerType,
      credit_score: formData.creditScore,
      estimated_dscr: formData.estimatedDscr || null,
      borrower_type: formData.borrowerType,
      is_foreign_national: false,
      is_first_time_investor: false,
    },
    loan_terms: {
      requested_amount: formData.loanAmount,
      purchase_price: formData.purchasePrice,
      loan_type: formData.loanType,
      occupancy_type: formData.occupancyType || 'Investment Property',
      transaction_type: formData.transactionType || 'Purchase',
      ltv,
    },
    property_details: {
      address_street: property?.address_street || formData.propertyAddress,
      address_city: property?.address_city || formData.propertyCity,
      address_state: property?.address_state || formData.propertyState,
      address_zip: property?.address_zip || formData.propertyZip,
      property_type: property?.property_type || null,
      total_units: property?.total_units || null,
      appraised_value: property?.appraised_value || null,
      purchase_price: formData.purchasePrice,
    },
    financial_metrics: {
      total_available_cash: totalCash,
      total_closing_balance: totalClosing,
      avg_monthly_deposits: avgDeposits,
      avg_monthly_withdrawals: avgWithdrawals,
      avg_monthly_net_flow: avgDeposits - avgWithdrawals,
      avg_monthly_balance: totalCash / monthCount,
      months_of_data: bankAccounts.length,
      accounts_found: bankAccounts.length,
    },
    underwriting_metrics: {
      loan_to_value: ltv,
      debt_service_coverage: formData.estimatedDscr || null,
      borrower_liquidity_ratio: requiredLiquidity > 0 ? totalCash / requiredLiquidity : 0,
      required_liquidity: requiredLiquidity,
      passes_liquidity_check: totalCash >= requiredLiquidity,
    },
    documents: {
      total_documents: documents.length,
      bank_statements: documents.filter(d => d.document_type === 'bank_statement').length,
      processed_documents: documents.filter(d => d.processing_status === 'completed').length,
      pending_documents: documents.filter(d => d.processing_status === 'pending').length,
      failed_documents: documents.filter(d => d.processing_status === 'failed').length,
    },
    packaged_at: new Date().toISOString(),
  };
}
