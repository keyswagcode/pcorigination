import { supabase } from './supabaseClient';
import type { BorrowerIdentityDocument, IdentityDocumentType } from '../shared/types';

export interface UploadIdentityDocParams {
  borrowerId: string;
  documentType: IdentityDocumentType;
  file: File;
}

export async function uploadIdentityDocument({
  borrowerId,
  documentType,
  file
}: UploadIdentityDocParams): Promise<BorrowerIdentityDocument | null> {
  const filePath = `borrowers/${borrowerId}/identity/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('borrower_identity_documents')
    .insert({
      borrower_id: borrowerId,
      document_type: documentType,
      file_name: file.name,
      storage_path: filePath,
      verification_status: 'pending_review'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function verifyIdentityDocument(
  documentId: string,
  verifiedBy: string
): Promise<void> {
  const { data: doc } = await supabase
    .from('borrower_identity_documents')
    .select('borrower_id')
    .eq('id', documentId)
    .single();

  const { error } = await supabase
    .from('borrower_identity_documents')
    .update({
      verification_status: 'verified',
      verified_by: verifiedBy,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', documentId);

  if (error) throw error;

  if (doc) {
    await supabase
      .from('borrowers')
      .update({ id_document_verified: true })
      .eq('id', doc.borrower_id);
  }
}

export async function rejectIdentityDocument(
  documentId: string,
  rejectedBy: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('borrower_identity_documents')
    .update({
      verification_status: 'rejected',
      verified_by: rejectedBy,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', documentId);

  if (error) throw error;
}

export async function getIdentityDocuments(borrowerId: string): Promise<BorrowerIdentityDocument[]> {
  const { data } = await supabase
    .from('borrower_identity_documents')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('uploaded_at', { ascending: false });

  return data || [];
}

export async function getLatestIdentityDocument(borrowerId: string): Promise<BorrowerIdentityDocument | null> {
  const { data } = await supabase
    .from('borrower_identity_documents')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}
