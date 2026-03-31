import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower, BorrowerIdentityDocument } from '../../shared/types';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle
} from 'lucide-react';
import { IdentityUploadCard } from '../../components/borrower/IdentityUploadCard';
import { DocumentUploadPanel } from '../../components/borrower/DocumentUploadPanel';

interface UploadedDoc {
  id: string;
  document_type: string;
  file_name: string;
  processing_status: string;
  created_at: string;
}

export function BorrowerDocumentsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [identityDoc, setIdentityDoc] = useState<BorrowerIdentityDocument | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: borrowerData } = await supabase
        .from('borrowers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      setBorrower(borrowerData);

      if (borrowerData) {
        const [docsRes, idDocRes] = await Promise.all([
          supabase
            .from('uploaded_documents')
            .select('id, document_type, file_name, processing_status, created_at')
            .eq('borrower_id', borrowerData.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('borrower_identity_documents')
            .select('*')
            .eq('borrower_id', borrowerData.id)
            .order('uploaded_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ]);

        setDocuments(docsRes.data || []);
        setIdentityDoc(idDocRes.data);
      }
    } finally {
      setLoading(false);
    }
  }

  const handleDocumentUploaded = useCallback(() => {
    loadData();
  }, []);

  const handleIdentityUploaded = useCallback(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Profile Required</h2>
          <p className="text-gray-600 mb-4">
            Please complete your profile before uploading documents.
          </p>
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'processed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
      case 'pending':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'bank_statement': 'Bank Statement',
      'tax_return': 'Tax Return',
      'w2': 'W-2 Form',
      '1099': '1099 Form',
      'liquidity_statement': 'Liquidity Statement',
      'entity_document': 'Entity Document',
      'id_document': 'ID Document',
      'other': 'Other'
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
        <p className="text-gray-600 mt-1">
          Upload your financial documents and identity verification
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DocumentUploadPanel
            borrowerId={borrower.id}
            onUploadComplete={handleDocumentUploaded}
          />

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">Uploaded Documents</h2>
                  <p className="text-sm text-gray-500">{documents.length} documents</p>
                </div>
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600">No documents uploaded yet</p>
                <p className="text-sm text-gray-500 mt-1">
                  Upload bank statements and other financial documents above
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {documents.map(doc => (
                  <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-gray-500" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{doc.file_name}</p>
                        <p className="text-xs text-gray-500">
                          {getDocumentTypeLabel(doc.document_type)} - {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusIcon(doc.processing_status)}
                      <span className="text-xs text-gray-500 capitalize">
                        {doc.processing_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <IdentityUploadCard
            borrowerId={borrower.id}
            identityDoc={identityDoc}
            onUploadComplete={handleIdentityUploaded}
          />
        </div>
      </div>
    </div>
  );
}
