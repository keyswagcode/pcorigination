import { supabase } from './supabaseClient';
import type { Borrower, BorrowerStatus } from '../shared/types';

export async function getBorrowerByUserId(userId: string): Promise<Borrower | null> {
  const { data } = await supabase
    .from('borrowers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return data;
}

export async function getBorrowerById(borrowerId: string): Promise<Borrower | null> {
  const { data } = await supabase
    .from('borrowers')
    .select('*')
    .eq('id', borrowerId)
    .maybeSingle();

  return data;
}

export async function createBorrower(borrowerData: Partial<Borrower>): Promise<Borrower | null> {
  const { data, error } = await supabase
    .from('borrowers')
    .insert({
      ...borrowerData,
      borrower_status: 'draft'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBorrower(borrowerId: string, updates: Partial<Borrower>): Promise<Borrower | null> {
  const { data, error } = await supabase
    .from('borrowers')
    .update(updates)
    .eq('id', borrowerId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBorrowerStatus(
  borrowerId: string,
  newStatus: BorrowerStatus
): Promise<void> {
  const { error } = await supabase
    .from('borrowers')
    .update({ borrower_status: newStatus })
    .eq('id', borrowerId);

  if (error) throw error;
}

export function canTransitionTo(currentStatus: BorrowerStatus, newStatus: BorrowerStatus): boolean {
  const validTransitions: Record<BorrowerStatus, BorrowerStatus[]> = {
    draft: ['submitted'],
    submitted: ['documents_processing', 'draft'],
    documents_processing: ['prequalified', 'submitted'],
    prequalified: ['under_review'],
    under_review: ['approved', 'conditionally_approved', 'declined', 'additional_docs_requested'],
    additional_docs_requested: ['submitted'],
    approved: [],
    conditionally_approved: ['approved', 'declined'],
    declined: []
  };

  return validTransitions[currentStatus]?.includes(newStatus) ?? false;
}

export function canCreateScenarios(status: BorrowerStatus | undefined): boolean {
  return status === 'approved' || status === 'conditionally_approved';
}
