import { supabase } from '../lib/supabase';
import { generateSchedule, maturityDateFrom } from '../lib/amortization';
import type {
  ServicedLoan,
  ServicedLoanScheduleRow,
  ServicedLoanPayment,
  ServicedLoanAchAuthorization,
} from '../shared/types';

// ============================================
// Read helpers (RLS does the scoping)
// ============================================

export async function listServicedLoansForBorrower(borrowerId: string): Promise<ServicedLoan[]> {
  const { data, error } = await supabase
    .from('serviced_loans')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listServicedLoansForOrg(): Promise<ServicedLoan[]> {
  const { data, error } = await supabase
    .from('serviced_loans')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getServicedLoan(id: string): Promise<ServicedLoan | null> {
  const { data, error } = await supabase
    .from('serviced_loans')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSchedule(servicedLoanId: string): Promise<ServicedLoanScheduleRow[]> {
  const { data, error } = await supabase
    .from('serviced_loan_schedule')
    .select('*')
    .eq('serviced_loan_id', servicedLoanId)
    .order('payment_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getPayments(servicedLoanId: string): Promise<ServicedLoanPayment[]> {
  const { data, error } = await supabase
    .from('serviced_loan_payments')
    .select('*')
    .eq('serviced_loan_id', servicedLoanId)
    .order('initiated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getActiveAchAuth(servicedLoanId: string): Promise<ServicedLoanAchAuthorization | null> {
  const { data, error } = await supabase
    .from('serviced_loan_ach_authorizations')
    .select('id, serviced_loan_id, provider, provider_account_id, authorization_id, authorized_amount_ceiling, account_mask, bank_name, account_holder_name, status, authorized_at, revoked_at, last_used_at')
    .eq('serviced_loan_id', servicedLoanId)
    .eq('status', 'active')
    .order('authorized_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  // provider_access_token_encrypted intentionally not selected (service-role only)
  return data ? { ...data, provider_access_token_encrypted: null } as ServicedLoanAchAuthorization : null;
}

export async function countActiveServicedLoansForBorrower(borrowerId: string): Promise<number> {
  const { count, error } = await supabase
    .from('serviced_loans')
    .select('id', { count: 'exact', head: true })
    .eq('borrower_id', borrowerId);
  if (error) throw error;
  return count || 0;
}

// ============================================
// Admin onboarding — creates the loan + amortization rows together
// ============================================

export interface OnboardServicedLoanInput {
  organization_id: string;
  borrower_id: string;
  loan_number: string;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  original_principal: number;
  interest_rate: number;            // decimal
  amortization_term_months: number;
  loan_term_months: number;
  origination_date: string;
  first_payment_date: string;
  escrow_taxes_monthly: number;
  escrow_insurance_monthly: number;
  late_fee_amount: number;
  grace_period_days: number;
}

export async function onboardServicedLoan(
  input: OnboardServicedLoanInput,
  createdByUserId: string,
): Promise<{ loan: ServicedLoan; scheduleRowCount: number }> {
  const maturity_date = maturityDateFrom(input.first_payment_date, input.loan_term_months);
  const escrowMonthly = input.escrow_taxes_monthly + input.escrow_insurance_monthly;

  // 1. Create the loan
  const { data: loan, error: insertError } = await supabase
    .from('serviced_loans')
    .insert({
      ...input,
      current_principal: input.original_principal,
      payment_frequency: 'monthly',
      maturity_date,
      next_payment_due_date: input.first_payment_date,
      escrow_balance: 0,
      servicing_status: 'active',
      created_by: createdByUserId,
    })
    .select('*')
    .single();
  if (insertError) throw insertError;
  if (!loan) throw new Error('Serviced loan insert returned no row');

  // 2. Generate and insert schedule
  const rows = generateSchedule({
    principal: input.original_principal,
    annualInterestRate: input.interest_rate,
    amortizationTermMonths: input.amortization_term_months,
    loanTermMonths: input.loan_term_months,
    firstPaymentDate: input.first_payment_date,
    escrowMonthly,
  });

  if (rows.length > 0) {
    const scheduleInserts = rows.map(r => ({
      serviced_loan_id: loan.id,
      payment_number: r.paymentNumber,
      due_date: r.dueDate,
      scheduled_principal: r.scheduledPrincipal,
      scheduled_interest: r.scheduledInterest,
      scheduled_escrow: r.scheduledEscrow,
      scheduled_total: r.scheduledTotal,
      ending_balance: r.endingBalance,
      status: 'scheduled',
    }));
    const { error: scheduleErr } = await supabase
      .from('serviced_loan_schedule')
      .insert(scheduleInserts);
    if (scheduleErr) throw scheduleErr;
  }

  return { loan, scheduleRowCount: rows.length };
}
