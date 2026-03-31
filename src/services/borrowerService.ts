import { supabase } from './supabaseClient';
import type { Borrower } from '../shared/types';

export async function getBorrowerForUser(userId: string): Promise<Borrower | null> {
  const { data } = await supabase
    .from('borrowers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return data as Borrower | null;
}

export async function getOrCreateBorrower(
  userId: string,
  organizationId: string | null,
  name: string,
  email: string
): Promise<Borrower> {
  const existing = await getBorrowerForUser(userId);
  if (existing) {
    if (!existing.organization_id && organizationId) {
      await supabase
        .from('borrowers')
        .update({ organization_id: organizationId })
        .eq('id', existing.id);
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('borrowers')
    .insert({
      borrower_name: name,
      entity_type: 'individual',
      email,
      user_id: userId,
      organization_id: organizationId,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Borrower;
}

export async function updateBorrowerEntity(
  borrowerId: string,
  entityName: string
): Promise<void> {
  await supabase
    .from('borrowers')
    .update({ borrower_name: entityName, entity_type: 'llc' })
    .eq('id', borrowerId);
}

export async function updateBorrowerLifecycleStage(
  borrowerId: string,
  stage: string
): Promise<void> {
  await supabase
    .from('borrowers')
    .update({ lifecycle_stage: stage })
    .eq('id', borrowerId);
}

export async function updateBorrowerLoanType(
  borrowerId: string,
  loanType: string
): Promise<void> {
  await supabase
    .from('borrowers')
    .update({
      preferred_loan_type: loanType,
      lifecycle_stage: 'loan_type_selected'
    })
    .eq('id', borrowerId);
}
