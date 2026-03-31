import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { BorrowerIdentityDocument, IdentityDocumentType } from '../../shared/types';
import {
  Shield,
  Upload,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  CreditCard,
  FileText
} from 'lucide-react';

interface IdentityUploadCardProps {
  borrowerId: string;
  identityDoc: BorrowerIdentityDocument | null;
  onUploadComplete: () => void;
}

const ID_TYPES: { value: IdentityDocumentType; label: string; icon: typeof CreditCard }[] = [
  { value: 'drivers_license', label: "Driver's License", icon: CreditCard },
  { value: 'passport', label: 'Passport', icon: FileText },
  { value: 'government_id', label: 'Government ID', icon: Shield },
];

export function IdentityUploadCard({ borrowerId, identityDoc, onUploadComplete }: IdentityUploadCardProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<IdentityDocumentType>('drivers_license');

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to upload documents');
      }

      const filePath = `borrowers/${user.id}/identity/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      if (identityDoc) {
        const { error: updateError } = await supabase
          .from('borrower_identity_documents')
          .update({
            document_type: selectedType,
            file_name: file.name,
            storage_path: filePath,
            verification_status: 'pending_review',
            updated_at: new Date().toISOString()
          })
          .eq('id', identityDoc.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('borrower_identity_documents').insert({
          borrower_id: borrowerId,
          document_type: selectedType,
          file_name: file.name,
          storage_path: filePath,
          verification_status: 'pending_review'
        });
        if (insertError) throw insertError;
      }

      onUploadComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      console.error('Identity upload failed:', err);
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const getStatusDisplay = () => {
    if (!identityDoc) {
      return {
        icon: Shield,
        iconColor: 'text-gray-400',
        bgColor: 'bg-gray-100',
        label: 'Not Uploaded',
        description: 'Upload a government-issued ID for verification'
      };
    }

    switch (identityDoc.verification_status) {
      case 'verified':
        return {
          icon: CheckCircle,
          iconColor: 'text-green-600',
          bgColor: 'bg-green-100',
          label: 'Verified',
          description: 'Your identity has been verified'
        };
      case 'pending_review':
        return {
          icon: Clock,
          iconColor: 'text-amber-600',
          bgColor: 'bg-amber-100',
          label: 'Pending Review',
          description: 'Your ID is being reviewed by our team'
        };
      case 'rejected':
        return {
          icon: XCircle,
          iconColor: 'text-red-600',
          bgColor: 'bg-red-100',
          label: 'Rejected',
          description: identityDoc.rejection_reason || 'Please upload a new document'
        };
      default:
        return {
          icon: Shield,
          iconColor: 'text-gray-400',
          bgColor: 'bg-gray-100',
          label: 'Unknown',
          description: ''
        };
    }
  };

  const status = getStatusDisplay();
  const Icon = status.icon;

  const canUpload = !identityDoc ||
    identityDoc.verification_status === 'rejected' ||
    identityDoc.verification_status === 'not_uploaded';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${status.bgColor}`}>
            <Icon className={`w-5 h-5 ${status.iconColor}`} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Identity Verification</h3>
            <p className="text-sm text-gray-500">{status.label}</p>
          </div>
        </div>
      </div>

      <div className="p-5">
        {identityDoc && identityDoc.verification_status !== 'rejected' && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-900">{identityDoc.file_name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {ID_TYPES.find(t => t.value === identityDoc.document_type)?.label} - Uploaded {new Date(identityDoc.uploaded_at).toLocaleDateString()}
            </p>
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4">
          {status.description}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {canUpload && (
          <>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Document Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as IdentityDocumentType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {ID_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              uploading ? 'bg-gray-50 border-gray-200 cursor-not-allowed' : 'border-teal-300 hover:border-teal-500 hover:bg-teal-50'
            }`}>
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
                  <span className="text-sm text-teal-700 font-medium">Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-teal-600" />
                  <span className="text-sm text-teal-700 font-medium">
                    {identityDoc ? 'Upload New ID' : 'Upload ID Document'}
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>

            <p className="text-xs text-gray-500 mt-2 text-center">
              JPG, PNG, or PDF - max 5MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}
