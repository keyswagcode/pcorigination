import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Upload, FileText, CheckCircle2, Clock, Trash2, Download,
  User, Building2, Hammer, Loader2, AlertCircle, Shield, Receipt
} from 'lucide-react';

interface DocCategory {
  key: string;
  label: string;
  description: string;
  icon: typeof FileText;
  accept: string;
  condition: 'always' | 'entity' | 'fix_flip';
}

const DOC_CATEGORIES: DocCategory[] = [
  { key: 'drivers_license', label: "Driver's License / Passport", description: 'Government-issued photo ID', icon: User, accept: '.pdf,.jpg,.jpeg,.png', condition: 'always' },
  { key: 'voided_check', label: 'Voided Check', description: 'For payment verification', icon: Receipt, accept: '.pdf,.jpg,.jpeg,.png', condition: 'always' },
  { key: 'property_insurance', label: 'Property Insurance', description: 'Proof of insurance coverage', icon: Shield, accept: '.pdf', condition: 'always' },
  { key: 'appraisal', label: 'Appraisal', description: 'Property appraisal report', icon: FileText, accept: '.pdf', condition: 'always' },
  { key: 'articles_of_incorporation', label: 'Articles of Incorporation', description: 'LLC or corporation formation docs', icon: Building2, accept: '.pdf', condition: 'entity' },
  { key: 'ein_letter', label: 'EIN Letter', description: 'IRS Employer Identification Number letter', icon: Building2, accept: '.pdf', condition: 'entity' },
  { key: 'operating_agreement', label: 'Operating Agreement', description: 'LLC operating agreement', icon: Building2, accept: '.pdf', condition: 'entity' },
  { key: 'rehab_budget', label: 'Rehab Budget', description: 'Detailed renovation/rehab budget', icon: Hammer, accept: '.pdf,.xlsx,.xls,.csv', condition: 'fix_flip' },
  { key: 'flip_experience', label: 'Flip Experience Sheet', description: 'Track record of flips in the last 2 years', icon: Hammer, accept: '.xlsx,.xls,.csv', condition: 'fix_flip' },
];

interface UploadedDoc {
  id: string;
  document_type: string;
  document_subtype: string | null;
  file_name: string;
  file_path: string;
  processing_status: string;
  created_at: string;
}

export function BorrowerDocumentsPage() {
  const { user } = useAuth();
  const [borrower, setBorrower] = useState<{ id: string; entity_type: string; preferred_loan_type: string | null } | null>(null);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFixFlipLoan, setHasFixFlipLoan] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    const { data: b } = await supabase
      .from('borrowers')
      .select('id, entity_type, preferred_loan_type')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!b) { setIsLoading(false); return; }
    setBorrower(b);

    const [docsResult, loansResult] = await Promise.all([
      supabase
        .from('uploaded_documents')
        .select('id, document_type, document_subtype, file_name, file_path, processing_status, created_at')
        .eq('borrower_id', b.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('loan_scenarios')
        .select('loan_type')
        .eq('borrower_id', b.id)
        .in('loan_type', ['fix_flip', 'bridge']),
    ]);

    setDocuments(docsResult.data || []);
    setHasFixFlipLoan((loansResult.data?.length || 0) > 0);
    setIsLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const isEntity = borrower?.entity_type && borrower.entity_type !== 'individual';
  const showFixFlip = hasFixFlipLoan || (borrower?.preferred_loan_type && ['fix_flip', 'bridge', 'fix_and_flip'].includes(borrower.preferred_loan_type));

  const visibleCategories = DOC_CATEGORIES.filter(cat => {
    if (cat.condition === 'always') return true;
    if (cat.condition === 'entity') return isEntity;
    if (cat.condition === 'fix_flip') return showFixFlip;
    return false;
  });

  const getDocsForCategory = (key: string) => documents.filter(d => d.document_type === key || d.document_subtype === key);

  const handleUpload = async (category: string, file: File) => {
    if (!borrower) return;
    setUploading(category);
    setError(null);

    try {
      const filePath = `${borrower.id}/${category}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('borrower-documents')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('uploaded_documents').insert({
        borrower_id: borrower.id,
        document_type: category,
        document_subtype: category,
        file_name: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        processing_status: 'uploaded',
      });
      if (insertError) throw insertError;

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (doc: UploadedDoc) => {
    try {
      await supabase.storage.from('borrower-documents').remove([doc.file_path]);
      await supabase.from('uploaded_documents').delete().eq('id', doc.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const downloadTemplate = () => {
    const headers = 'Property Address,Purchase Price,Rehab Cost,Sale Price,Profit,Date Completed';
    const example = '123 Main St San Diego CA,250000,75000,400000,75000,2025-06-15';
    const csv = `${headers}\n${example}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flip-experience-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Profile Found</h2>
        <p className="text-gray-500">Please complete your application signup first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Documents</h1>
        <p className="text-gray-500 mt-1">Upload your documents below. All documents are optional but may be requested by your broker.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-4">
        {visibleCategories.map(cat => {
          const catDocs = getDocsForCategory(cat.key);
          const isUploading = uploading === cat.key;
          const Icon = cat.icon;

          return (
            <div key={cat.key} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${catDocs.length > 0 ? 'bg-teal-100' : 'bg-gray-100'}`}>
                      {catDocs.length > 0 ? (
                        <CheckCircle2 className="w-5 h-5 text-teal-600" />
                      ) : (
                        <Icon className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{cat.label}</h3>
                      <p className="text-sm text-gray-500">{cat.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {cat.key === 'flip_experience' && (
                      <button
                        onClick={downloadTemplate}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Template
                      </button>
                    )}

                    <label className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                      isUploading
                        ? 'bg-gray-100 text-gray-400 pointer-events-none'
                        : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}>
                      <input
                        type="file"
                        accept={cat.accept}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(cat.key, file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Upload
                    </label>
                  </div>
                </div>

                {catDocs.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {catDocs.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{doc.file_name}</span>
                          <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                            <Clock className="w-3 h-3" />
                            {new Date(doc.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDelete(doc)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
