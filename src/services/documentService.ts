import { supabase } from './supabaseClient';
import type { UploadedDocument, DocumentClassification, ExtractionAuditEntry, NormalizedBankAccount } from '../shared/types';

export async function uploadDocument(
  userId: string,
  submissionId: string,
  borrowerId: string,
  file: File
): Promise<{ documentId: string; filePath: string }> {
  const fileId = crypto.randomUUID();
  const filePath = `${userId}/${submissionId}/${fileId}-${file.name}`;

  const { error: storageError } = await supabase.storage
    .from('borrower-documents')
    .upload(filePath, file);

  if (storageError) throw storageError;

  const { data, error: dbError } = await supabase
    .from('uploaded_documents')
    .insert({
      intake_submission_id: submissionId,
      borrower_id: borrowerId,
      file_path: filePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      document_type: 'bank_statement',
      processing_status: 'pending',
    })
    .select('id')
    .single();

  if (dbError) throw dbError;

  return { documentId: data.id, filePath };
}

// Upload an app-generated document (e.g. a credit-consent PDF) straight to the
// borrower's Documents folder. Unlike uploadDocument(), this doesn't require an
// intake submission — it keys off the borrower, mirroring the credit-report
// upload done by the pull-credit edge function.
export async function uploadBorrowerDocument(
  borrowerId: string,
  blob: Blob,
  fileName: string,
  documentType: string,
  documentSubtype?: string,
): Promise<string> {
  // Store under the canonical borrowers/{auth_user_id}/... prefix (same as
  // bank-statement uploads) so storage policies that key off the caller's
  // folder keep working. Falls back to the borrower id when no session.
  const { data: auth } = await supabase.auth.getUser();
  const ownerSegment = auth?.user?.id || borrowerId;
  const filePath = `borrowers/${ownerSegment}/${documentType}/${fileName}`;

  const { error: storageError } = await supabase.storage
    .from('borrower-documents')
    .upload(filePath, blob, { contentType: blob.type || 'application/pdf', upsert: false });
  if (storageError) throw storageError;

  const { data, error: dbError } = await supabase
    .from('uploaded_documents')
    .insert({
      borrower_id: borrowerId,
      file_path: filePath,
      file_name: fileName,
      file_size: blob.size,
      mime_type: blob.type || 'application/pdf',
      document_type: documentType,
      document_subtype: documentSubtype || null,
      processing_status: 'uploaded',
    })
    .select('id')
    .single();
  if (dbError) throw dbError;

  return data.id;
}

export async function fetchDocumentsForApplication(submissionId: string): Promise<UploadedDocument[]> {
  const { data } = await supabase
    .from('uploaded_documents')
    .select('*')
    .eq('intake_submission_id', submissionId)
    .order('created_at', { ascending: false });

  return (data as UploadedDocument[]) || [];
}

export async function fetchDocumentClassifications(documentId: string): Promise<DocumentClassification | null> {
  const { data } = await supabase
    .from('document_classifications')
    .select('*')
    .eq('uploaded_document_id', documentId)
    .maybeSingle();

  return data as DocumentClassification | null;
}

export async function fetchExtractionAuditTrail(documentId: string): Promise<ExtractionAuditEntry[]> {
  const { data } = await supabase
    .from('extraction_audit_log')
    .select('*')
    .eq('uploaded_document_id', documentId)
    .order('field_name');

  return (data as ExtractionAuditEntry[]) || [];
}

export async function fetchNormalizedBankAccounts(submissionId: string): Promise<NormalizedBankAccount[]> {
  const { data } = await supabase
    .from('normalized_bank_accounts')
    .select('*')
    .eq('intake_submission_id', submissionId);

  return (data as NormalizedBankAccount[]) || [];
}

export async function triggerDocumentProcessing(submissionId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ submission_id: submissionId }),
    }
  );

  if (!response.ok) {
    throw new Error('Document processing failed');
  }
}

export async function fetchBankStatementAccounts(submissionId: string) {
  const { data } = await supabase
    .from('bank_statement_accounts')
    .select('*')
    .eq('intake_submission_id', submissionId);

  return data || [];
}
