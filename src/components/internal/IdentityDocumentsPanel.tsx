import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { BorrowerIdentityDocument } from '../../shared/types';
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Loader2
} from 'lucide-react';

interface IdentityDocumentsPanelProps {
  identityDocs: BorrowerIdentityDocument[];
  borrowerId: string;
  onUpdate: () => void;
}

export function IdentityDocumentsPanel({ identityDocs, borrowerId, onUpdate }: IdentityDocumentsPanelProps) {
  const { user } = useAuth();
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

  const handleVerify = async (docId: string) => {
    setProcessing(docId);
    try {
      await supabase
        .from('borrower_identity_documents')
        .update({
          verification_status: 'verified',
          verified_by: user?.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', docId);

      await supabase
        .from('borrowers')
        .update({ id_document_verified: true })
        .eq('id', borrowerId);

      onUpdate();
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (docId: string) => {
    setProcessing(docId);
    try {
      await supabase
        .from('borrower_identity_documents')
        .update({
          verification_status: 'rejected',
          rejection_reason: rejectReason,
          verified_by: user?.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', docId);

      setShowRejectModal(null);
      setRejectReason('');
      onUpdate();
    } finally {
      setProcessing(null);
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'verified':
        return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', label: 'Verified' };
      case 'rejected':
        return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', label: 'Rejected' };
      case 'pending_review':
      default:
        return { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100', label: 'Pending Review' };
    }
  };

  const getDocTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      drivers_license: "Driver's License",
      passport: 'Passport',
      government_id: 'Government ID'
    };
    return labels[type] || type;
  };

  return (
    <div>
      <h3 className="font-semibold text-gray-900 mb-4">Identity Documents</h3>

      {identityDocs.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No identity documents uploaded</p>
        </div>
      ) : (
        <div className="space-y-4">
          {identityDocs.map(doc => {
            const status = getStatusDisplay(doc.verification_status);
            const StatusIcon = status.icon;

            return (
              <div
                key={doc.id}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                <div className="p-4 flex items-center justify-between bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${status.bg}`}>
                      <Shield className={`w-5 h-5 ${status.color}`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{doc.file_name}</p>
                      <p className="text-sm text-gray-500">
                        {getDocTypeLabel(doc.document_type)} - Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${status.bg} ${status.color}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {status.label}
                  </span>
                </div>

                {doc.verification_status === 'pending_review' && (
                  <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-between">
                    <button
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                      <Eye className="w-4 h-4" />
                      View Document
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowRejectModal(doc.id)}
                        disabled={processing === doc.id}
                        className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleVerify(doc.id)}
                        disabled={processing === doc.id}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {processing === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Verify
                      </button>
                    </div>
                  </div>
                )}

                {doc.verification_status === 'rejected' && doc.rejection_reason && (
                  <div className="p-4 border-t border-gray-200 bg-red-50">
                    <p className="text-sm text-red-700">
                      <strong>Rejection reason:</strong> {doc.rejection_reason}
                    </p>
                  </div>
                )}

                {doc.verification_status === 'verified' && doc.verified_at && (
                  <div className="p-4 border-t border-gray-200 bg-green-50">
                    <p className="text-sm text-green-700">
                      Verified on {new Date(doc.verified_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-4">Reject Identity Document</h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide a reason for rejecting this document.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="e.g., Document is expired, image is blurry..."
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setShowRejectModal(null); setRejectReason(''); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={!rejectReason.trim() || processing === showRejectModal}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {processing === showRejectModal ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                Reject Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
