import type { Borrower, PrequalResult, BorrowerStatus } from '../../shared/types';
import {
  User,
  Mail,
  Phone,
  MapPin,
  CheckCircle,
  Clock,
  AlertCircle,
  Shield,
  XCircle,
  Search
} from 'lucide-react';

interface BorrowerFileHeaderProps {
  borrower: Borrower;
  prequal: PrequalResult | null;
}

const statusConfig: Record<BorrowerStatus, {
  label: string;
  color: string;
  bgColor: string;
  icon: typeof Clock;
}> = {
  draft: { label: 'Draft', color: 'text-gray-700', bgColor: 'bg-gray-100', icon: Clock },
  submitted: { label: 'Submitted', color: 'text-blue-700', bgColor: 'bg-blue-100', icon: Clock },
  documents_processing: { label: 'Processing', color: 'text-amber-700', bgColor: 'bg-amber-100', icon: Clock },
  prequalified: { label: 'Pre-Approved', color: 'text-teal-700', bgColor: 'bg-teal-100', icon: CheckCircle },
  under_review: { label: 'Under Review', color: 'text-indigo-700', bgColor: 'bg-indigo-100', icon: Search },
  additional_docs_requested: { label: 'Docs Requested', color: 'text-orange-700', bgColor: 'bg-orange-100', icon: AlertCircle },
  approved: { label: 'Approved', color: 'text-green-700', bgColor: 'bg-green-100', icon: Shield },
  conditionally_approved: { label: 'Conditionally Approved', color: 'text-emerald-700', bgColor: 'bg-emerald-100', icon: CheckCircle },
  declined: { label: 'Declined', color: 'text-red-700', bgColor: 'bg-red-100', icon: XCircle }
};

export function BorrowerFileHeader({ borrower, prequal }: BorrowerFileHeaderProps) {
  const status = borrower.borrower_status || 'draft';
  const config = statusConfig[status] || statusConfig.draft;
  const StatusIcon = config.icon;

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center">
            <User className="w-7 h-7 text-slate-600" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{borrower.borrower_name}</h1>
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${config.bgColor} ${config.color}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {config.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
              {borrower.email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  {borrower.email}
                </span>
              )}
              {borrower.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" />
                  {borrower.phone}
                </span>
              )}
              {borrower.state_of_residence && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {borrower.state_of_residence}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Credit Score</p>
            <p className={`text-2xl font-bold ${
              (borrower.credit_score || 0) >= 740 ? 'text-green-600' :
              (borrower.credit_score || 0) >= 680 ? 'text-amber-600' :
              borrower.credit_score ? 'text-red-600' : 'text-gray-400'
            }`}>
              {borrower.credit_score || '-'}
            </p>
          </div>
          {prequal && (
            <div className="text-center pl-6 border-l border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Pre-Approved</p>
              <p className="text-2xl font-bold text-teal-600">
                {formatCurrency(prequal.prequalified_amount)}
              </p>
            </div>
          )}
          <div className="text-center pl-6 border-l border-gray-200">
            <p className="text-xs text-gray-500 uppercase tracking-wide">ID Verified</p>
            <div className="mt-1">
              {borrower.id_document_verified ? (
                <Shield className="w-6 h-6 text-green-500 mx-auto" />
              ) : (
                <Shield className="w-6 h-6 text-gray-300 mx-auto" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
