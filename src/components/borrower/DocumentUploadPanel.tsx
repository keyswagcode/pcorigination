import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle, Building2, User, Wallet } from 'lucide-react';

type BorrowerType = 'personal' | 'entity';

interface DocumentUploadPanelProps {
  borrowerId: string;
  borrowerType?: BorrowerType;
  onUploadComplete: () => void;
}

const PERSONAL_DOCUMENT_TYPES = [
  { value: 'bank_statement', label: 'Bank Statements (12 months preferred)', required: true },
  { value: 'liquidity_statement', label: 'Verification of Liquidity / Reserves', required: true },
  { value: 'brokerage_statement', label: 'Brokerage Statements', required: false },
  { value: 'other', label: 'Other Supporting Financial Documents', required: false },
];

const ENTITY_DOCUMENT_TYPES = [
  { value: 'bank_statement', label: 'Business Bank Statements (12 months preferred)', required: true },
  { value: 'liquidity_statement', label: 'Verification of Liquidity / Reserves', required: true },
  { value: 'entity_document', label: 'Entity Formation Documents (LLC / Corporation)', required: true },
  { value: 'operating_agreement', label: 'Operating Agreement', required: false },
  { value: 'brokerage_statement', label: 'Brokerage Statements', required: false },
  { value: 'other', label: 'Other Supporting Financial Documents', required: false },
];

interface PendingFile {
  file: File;
  type: string;
  uploading: boolean;
  error?: string;
  complete?: boolean;
}

export function DocumentUploadPanel({ borrowerId, borrowerType = 'personal', onUploadComplete }: DocumentUploadPanelProps) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const documentTypes = borrowerType === 'entity' ? ENTITY_DOCUMENT_TYPES : PERSONAL_DOCUMENT_TYPES;
  const requiredDocs = documentTypes.filter(d => d.required);
  const optionalDocs = documentTypes.filter(d => !d.required);

  const handleFiles = useCallback((files: FileList) => {
    const defaultType = borrowerType === 'entity' ? 'bank_statement' : 'bank_statement';
    const newFiles: PendingFile[] = Array.from(files).map(file => ({
      file,
      type: defaultType,
      uploading: false
    }));
    setPendingFiles(prev => [...prev, ...newFiles]);
  }, [borrowerType]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const removeFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const updateFileType = (index: number, type: string) => {
    setPendingFiles(prev => prev.map((f, i) => i === index ? { ...f, type } : f));
  };

  const uploadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return;
    }

    for (let i = 0; i < pendingFiles.length; i++) {
      if (pendingFiles[i].complete) continue;

      setPendingFiles(prev => prev.map((f, idx) => idx === i ? { ...f, uploading: true } : f));

      const file = pendingFiles[i];
      const timestamp = Date.now();
      const filePath = `borrowers/${user.id}/financial/${timestamp}_${file.file.name}`;
      console.log('Uploading to path:', filePath, 'user:', user.id);

      try {
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file.file);

        if (uploadError) throw uploadError;

        const { data: submission } = await supabase
          .from('intake_submissions')
          .select('id')
          .eq('borrower_id', borrowerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let submissionId = submission?.id;

        if (!submissionId) {
          const { data: newSubmission } = await supabase
            .from('intake_submissions')
            .insert({
              borrower_id: borrowerId,
              status: 'draft',
              processing_stage: 'document_upload'
            })
            .select('id')
            .single();

          submissionId = newSubmission?.id;
        }

        if (submissionId) {
          await supabase.from('uploaded_documents').insert({
            intake_submission_id: submissionId,
            borrower_id: borrowerId,
            document_type: file.type,
            file_name: file.file.name,
            file_path: filePath,
            file_size_bytes: file.file.size,
            mime_type: file.file.type,
            processing_status: 'pending'
          });
        }

        setPendingFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, uploading: false, complete: true } : f
        ));
      } catch {
        setPendingFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, uploading: false, error: 'Upload failed' } : f
        ));
      }
    }

    onUploadComplete();
    setTimeout(() => {
      setPendingFiles(prev => prev.filter(f => !f.complete));
    }, 2000);
  };

  const hasFilesToUpload = pendingFiles.some(f => !f.complete);

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          {borrowerType === 'entity' ? (
            <Building2 className="w-4 h-4 text-teal-600" />
          ) : (
            <User className="w-4 h-4 text-teal-600" />
          )}
          <span className="text-sm font-medium text-gray-900">
            Documentation Requirements — {borrowerType === 'entity' ? 'Entity Borrower' : 'Personal Borrower'}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Required Documentation</p>
            <div className="space-y-1.5">
              {requiredDocs.map(doc => (
                <div key={doc.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                  {doc.label}
                </div>
              ))}
            </div>
          </div>

          {optionalDocs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Supplemental Documentation (if applicable)</p>
              <div className="space-y-1.5">
                {optionalDocs.map(doc => (
                  <div key={doc.value} className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                    {doc.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="flex items-start gap-2">
            <Wallet className="w-4 h-4 text-teal-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-700">Liquidity Verification</p>
              <p className="text-xs text-gray-500">Please provide documentation evidencing available funds and reserves to support the requested financing.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
            <Upload className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Document Submission</h2>
            <p className="text-sm text-gray-500">
              {borrowerType === 'entity'
                ? 'Business financial statements, entity formation documents, and liquidity verification'
                : 'Personal financial statements and liquidity verification'
              }
            </p>
          </div>
        </div>

        <div className="p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragOver ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 mb-2">
              Drag and drop files here, or{' '}
              <label className="text-teal-600 font-medium cursor-pointer hover:text-teal-700">
                browse
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </label>
            </p>
            <p className="text-xs text-gray-500">
              PDF, PNG, or JPG (max 10MB each)
            </p>
          </div>

          {pendingFiles.length > 0 && (
            <div className="mt-4 space-y-3">
              {pendingFiles.map((file, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    file.complete ? 'bg-green-50 border-green-200' :
                    file.error ? 'bg-red-50 border-red-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
                    {file.uploading ? (
                      <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
                    ) : file.complete ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <FileText className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.file.name}
                    </p>
                    {file.error && (
                      <p className="text-xs text-red-600">{file.error}</p>
                    )}
                  </div>
                  {!file.complete && !file.uploading && (
                    <>
                      <select
                        value={file.type}
                        onChange={(e) => updateFileType(index, e.target.value)}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        {documentTypes.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                            {type.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {hasFilesToUpload && (
                <button
                  onClick={uploadAll}
                  disabled={pendingFiles.some(f => f.uploading)}
                  className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {pendingFiles.some(f => f.uploading) ? 'Uploading...' : 'Upload All'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {borrowerType === 'entity' && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            Entity borrowers are required to submit formation documents evidencing the legal structure of the borrowing entity.
          </p>
        </div>
      )}
    </div>
  );
}
