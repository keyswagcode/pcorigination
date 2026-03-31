import { supabase } from './supabaseClient';
import type { LoanScenario, LoanScenarioStatus } from '../shared/types';
import { canCreateScenarios } from './borrowerProfileService';

export interface CreateScenarioParams {
  borrowerId: string;
  scenarioName: string;
  loanType?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  propertyType?: string;
  occupancy?: string;
  purchasePrice?: number;
  estimatedValue?: number;
  loanAmount?: number;
  rent?: number;
  loanPurpose?: string;
}

export async function createLoanScenario(params: CreateScenarioParams): Promise<LoanScenario | null> {
  const { data: borrower } = await supabase
    .from('borrowers')
    .select('borrower_status')
    .eq('id', params.borrowerId)
    .maybeSingle();

  if (!borrower || !canCreateScenarios(borrower.borrower_status)) {
    throw new Error('Borrower must be approved to create loan scenarios');
  }

  let ltv: number | null = null;
  let dscr: number | null = null;

  const value = params.estimatedValue || params.purchasePrice;
  if (params.loanAmount && value) {
    ltv = (params.loanAmount / value) * 100;
  }

  if (params.rent && params.loanAmount) {
    const estimatedPayment = (params.loanAmount * 0.07) / 12;
    dscr = params.rent / estimatedPayment;
  }

  const { data, error } = await supabase
    .from('loan_scenarios')
    .insert({
      borrower_id: params.borrowerId,
      scenario_name: params.scenarioName,
      loan_type: params.loanType,
      property_address: params.propertyAddress,
      property_city: params.propertyCity,
      property_state: params.propertyState,
      property_zip: params.propertyZip,
      property_type: params.propertyType,
      occupancy: params.occupancy,
      purchase_price: params.purchasePrice,
      estimated_value: params.estimatedValue || params.purchasePrice,
      loan_amount: params.loanAmount,
      ltv,
      rent: params.rent,
      dscr,
      loan_purpose: params.loanPurpose,
      status: 'draft'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateLoanScenario(
  scenarioId: string,
  updates: Partial<LoanScenario>
): Promise<LoanScenario | null> {
  const { data, error } = await supabase
    .from('loan_scenarios')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', scenarioId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateScenarioStatus(
  scenarioId: string,
  status: LoanScenarioStatus
): Promise<void> {
  const { error } = await supabase
    .from('loan_scenarios')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', scenarioId);

  if (error) throw error;
}

export async function getScenariosByBorrower(borrowerId: string): Promise<LoanScenario[]> {
  const { data } = await supabase
    .from('loan_scenarios')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('created_at', { ascending: false });

  return data || [];
}

export async function getScenarioById(scenarioId: string): Promise<LoanScenario | null> {
  const { data } = await supabase
    .from('loan_scenarios')
    .select('*')
    .eq('id', scenarioId)
    .maybeSingle();

  return data;
}

export async function deleteScenario(scenarioId: string): Promise<void> {
  const { error } = await supabase
    .from('loan_scenarios')
    .delete()
    .eq('id', scenarioId)
    .eq('status', 'draft');

  if (error) throw error;
}

export async function submitScenario(scenarioId: string): Promise<void> {
  const { error } = await supabase
    .from('loan_scenarios')
    .update({
      status: 'submitted',
      updated_at: new Date().toISOString()
    })
    .eq('id', scenarioId)
    .eq('status', 'draft');

  if (error) throw error;
}
