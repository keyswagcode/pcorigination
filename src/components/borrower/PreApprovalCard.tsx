import { CheckCircle, ArrowRight, DollarSign, Shield, AlertCircle, FileText, Download, Clock } from 'lucide-react';
import { getLoanTypeConfig, type BorrowerLoanType } from '../../lib/loanTypeDocuments';

interface PreApprovalData {
  status: string;
  qualification_min: number | null;
  qualification_max: number | null;
  recommended_amount: number | null;
  verified_liquidity: number | null;
  required_liquidity: number | null;
  passes_liquidity_check: boolean | null;
  machine_decision: string | null;
  conditions: string[] | null;
  letter_number?: string | null;
  created_at: string;
}

interface PreApprovalCardProps {
  preApproval: PreApprovalData;
  loanType: BorrowerLoanType | string | null;
  onStartApplication: () => void;
  onDownloadLetter?: () => void;
}

export function PreApprovalCard({
  preApproval,
  loanType,
  onStartApplication,
  onDownloadLetter,
}: PreApprovalCardProps) {
  const loanConfig = getLoanTypeConfig(loanType as BorrowerLoanType);
  const isQualified = preApproval.passes_liquidity_check;

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (!isQualified) {
    return (
      <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
        <div className="bg-amber-50 px-6 py-4 border-b border-amber-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-900">Application Under Review</h3>
              <p className="text-sm text-amber-700">Our team is reviewing your documents</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="bg-amber-50 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              We're reviewing your submitted documents. You'll receive an update once the review is complete.
              This typically takes 1-2 business days.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">You're Pre-Approved!</h3>
              <p className="text-teal-100 text-sm">
                {loanConfig.label} Loan Pre-Approval Complete
              </p>
            </div>
          </div>
          {preApproval.letter_number && onDownloadLetter && (
            <button
              onClick={onDownloadLetter}
              className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Letter
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-teal-50 rounded-lg p-4 border border-teal-100">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-teal-600" />
              <p className="text-xs text-teal-700 font-medium">Qualification Range</p>
            </div>
            <p className="text-lg font-bold text-gray-900">
              {formatCurrency(preApproval.qualification_min)} - {formatCurrency(preApproval.qualification_max)}
            </p>
          </div>
          <div className="bg-teal-50 rounded-lg p-4 border border-teal-100">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-teal-600" />
              <p className="text-xs text-teal-700 font-medium">Max Pre-Approved Amount</p>
            </div>
            <p className="text-lg font-bold text-gray-900">
              {formatCurrency(preApproval.recommended_amount)}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-gray-400" />
            <div>
              <p className="font-medium text-gray-900">Ready to Continue?</p>
              <p className="text-sm text-gray-500">
                Start your {loanConfig.label} loan application to lock in a property
              </p>
            </div>
          </div>

          <button
            onClick={onStartApplication}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
          >
            Start {loanConfig.label} Loan Application
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
