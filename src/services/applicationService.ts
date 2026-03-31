import { supabase } from './supabaseClient';
import type { Application, ApplicationStatus, ApplicationStatusHistory } from '../shared/types';
import { VALID_STATUS_TRANSITIONS } from '../shared/constants';

export async function fetchBorrowerApplications(userId: string): Promise<Application[]> {
  const { data } = await supabase
    .from('intake_submissions')
    .select(`
      id,
      status,
      processing_stage,
      created_at,
      submitted_at,
      updated_at,
      user_id,
      organization_id,
      borrower_id,
      loan_requests (id, requested_amount, loan_purpose),
      properties (id, address_street, address_city, address_state, address_zip, property_type),
      uploaded_documents (id, file_name, document_type, processing_status, extraction_status, created_at)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data as unknown as Application[]) || [];
}

export async function fetchOrganizationApplications(
  organizationId: string,
  status?: ApplicationStatus
): Promise<Application[]> {
  let query = supabase
    .from('intake_submissions')
    .select(`
      id,
      status,
      processing_stage,
      created_at,
      submitted_at,
      updated_at,
      user_id,
      organization_id,
      borrower_id,
      borrowers (
        id,
        borrower_name,
        email,
        phone,
        entity_type,
        credit_score,
        state_of_residence,
        real_estate_experience_years,
        properties_owned_count
      ),
      loan_requests (id, requested_amount, loan_purpose),
      properties (id, address_street, address_city, address_state, address_zip, property_type),
      uploaded_documents (id, file_name, document_type, processing_status, extraction_status, created_at)
    `)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data } = await query;
  return (data as unknown as Application[]) || [];
}

export async function fetchApplicationById(applicationId: string): Promise<Application | null> {
  const { data } = await supabase
    .from('intake_submissions')
    .select(`
      id,
      status,
      processing_stage,
      created_at,
      submitted_at,
      updated_at,
      user_id,
      organization_id,
      borrower_id,
      borrowers (
        id,
        borrower_name,
        email,
        phone,
        entity_type,
        credit_score,
        state_of_residence,
        real_estate_experience_years,
        properties_owned_count,
        portfolio_value
      ),
      loan_requests (
        id,
        requested_amount,
        loan_purpose,
        estimated_purchase_price,
        down_payment_amount,
        down_payment_source
      ),
      properties (
        id,
        address_street,
        address_city,
        address_state,
        address_zip,
        property_type,
        occupancy_type,
        number_of_units,
        purchase_price,
        monthly_rent
      ),
      uploaded_documents (
        id,
        file_name,
        document_type,
        processing_status,
        extraction_status,
        extraction_confidence,
        created_at
      )
    `)
    .eq('id', applicationId)
    .maybeSingle();

  return data as unknown as Application | null;
}

export async function createDraftApplication(
  userId: string,
  borrowerId: string,
  organizationId: string | null
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('intake_submissions')
    .insert({
      user_id: userId,
      borrower_id: borrowerId,
      organization_id: organizationId,
      status: 'draft',
      processing_stage: 'documents_uploading',
    })
    .select('id')
    .single();

  return data;
}

export async function updateApplicationStatus(
  applicationId: string,
  newStatus: ApplicationStatus,
  changedByUserId: string,
  notes?: string
): Promise<void> {
  const { data: current } = await supabase
    .from('intake_submissions')
    .select('status')
    .eq('id', applicationId)
    .maybeSingle();

  const currentStatus = current?.status as ApplicationStatus;

  if (currentStatus && !VALID_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
  }

  await supabase
    .from('intake_submissions')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', applicationId);

  await supabase.from('application_status_history').insert({
    application_id: applicationId,
    previous_status: currentStatus || null,
    new_status: newStatus,
    changed_by_user_id: changedByUserId,
    notes: notes || null,
  });
}

export async function submitApplication(
  applicationId: string,
  userId: string
): Promise<void> {
  await supabase
    .from('intake_submissions')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      processing_stage: 'pre_approval_complete',
    })
    .eq('id', applicationId);

  await supabase.from('application_status_history').insert({
    application_id: applicationId,
    previous_status: 'draft',
    new_status: 'submitted',
    changed_by_user_id: userId,
    notes: 'Application submitted by borrower',
  });
}

export async function fetchStatusHistory(applicationId: string): Promise<ApplicationStatusHistory[]> {
  const { data } = await supabase
    .from('application_status_history')
    .select('*')
    .eq('application_id', applicationId)
    .order('changed_at', { ascending: false });

  return data || [];
}

export async function fetchStatusCounts(organizationId: string): Promise<Record<ApplicationStatus, number>> {
  const { data } = await supabase
    .from('intake_submissions')
    .select('status')
    .eq('organization_id', organizationId);

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }

  return counts as Record<ApplicationStatus, number>;
}

export async function autosaveLoanRequest(
  submissionId: string,
  loanAmount: number | null,
  loanType: string | null
): Promise<void> {
  const { data: existing } = await supabase
    .from('loan_requests')
    .select('id')
    .eq('intake_submission_id', submissionId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('loan_requests')
      .update({
        requested_amount: loanAmount || null,
        loan_purpose: loanType || null,
      })
      .eq('id', existing.id);
  } else if (loanAmount || loanType) {
    await supabase.from('loan_requests').insert({
      intake_submission_id: submissionId,
      requested_amount: loanAmount || null,
      loan_purpose: loanType || null,
    });
  }
}

export async function autosaveProperty(
  submissionId: string,
  fields: {
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    property_type?: string;
    purchase_price?: number;
  }
): Promise<void> {
  const { data: existing } = await supabase
    .from('properties')
    .select('id')
    .eq('intake_submission_id', submissionId)
    .maybeSingle();

  const payload = {
    address_street: fields.address_street || null,
    address_city: fields.address_city || null,
    address_state: fields.address_state || null,
    address_zip: fields.address_zip || null,
    property_type: fields.property_type || null,
    purchase_price: fields.purchase_price || null,
  };

  if (existing) {
    await supabase.from('properties').update(payload).eq('id', existing.id);
  } else if (fields.address_state || fields.property_type) {
    await supabase.from('properties').insert({
      intake_submission_id: submissionId,
      ...payload,
    });
  }
}
