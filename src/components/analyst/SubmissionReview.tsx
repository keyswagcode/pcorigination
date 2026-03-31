import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, User, Building2, DollarSign, MapPin, Calendar, FileText, CheckCircle as CheckCircle2, Circle as XCircle, Clock, AlertTriangle, Download, Eye, Loader as Loader2, Phone, Mail, Hop as Home, Banknote, Shield, Bot, BookOpen } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PlacerBotPanel } from '../placerbot';
import { LenderRulebookPanel } from './LenderRulebookPanel';

interface SubmissionReviewProps {
  submissionId: string;
  onBack: () => void;
}

interface SubmissionDetail {
  id: string;
  status: string;
  processing_stage: string;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  borrowers: {
    id: string;
    borrower_name: string;
    entity_type: string;
    email: string | null;
    phone: string | null;
    ssn_ein_masked: string | null;
    state_of_residence: string | null;
    years_self_employed: number | null;
  } | null;
  loan_requests: Array<{
    id: string;
    requested_amount: number;
    loan_purpose: string;
  }>;
  properties: Array<{
    id: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    property_type: string;
    total_units: number | null;
    appraised_value: number | null;
    purchase_price: number | null;
  }>;
  documents: Array<{
    id: string;
    document_type: string;
    file_name: string;
    processing_status: string;
    file_path: string;
    created_at: string;
  }>;
  aggregated_bank_metrics: Array<{
    id: string;
    total_available_cash: number | null;
    avg_monthly_deposits: number | null;
    avg_monthly_withdrawals: number | null;
    avg_monthly_net_cash_flow: number | null;
  }>;
  pre_approvals: Array<{
    id: string;
    status: string;
    requested_loan_amount: number | null;
    verified_liquidity: number | null;
    required_liquidity: number | null;
    passes_liquidity_check: boolean | null;
    qualification_min: number | null;
    qualification_max: number | null;
    recommended_amount: number | null;
    conditions: string[];
    machine_decision: string | null;
    machine_confidence: number | null;
    issued_at: string | null;
    expires_at: string | null;
  }>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  pending_review: { label: 'Pending Review', color: 'text-amber-600', bgColor: 'bg-amber-100' },
  processing: { label: 'Processing', color: 'text-teal-600', bgColor: 'bg-teal-100' },
  approved: { label: 'Approved', color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  declined: { label: 'Declined', color: 'text-red-600', bgColor: 'bg-red-100' },
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  refinance: 'Refinance',
  cash_out_refinance: 'Cash-Out Refinance',
  dscr: 'DSCR',
  bridge: 'Bridge',
  fix_flip: 'Fix & Flip',
  construction: 'Construction',
};

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  single_family: 'Single Family',
  multi_family: 'Multi-Family',
  condo: 'Condo',
  townhouse: 'Townhouse',
  commercial: 'Commercial',
  mixed_use: 'Mixed Use',
};

export function SubmissionReview({ submissionId, onBack }: SubmissionReviewProps) {
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'financials' | 'placerbot' | 'rulebook'>('overview');
  const [updating, setUpdating] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineModal, setShowDeclineModal] = useState(false);

  const fetchSubmission = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('intake_submissions')
      .select(`
        id,
        status,
        processing_stage,
        created_at,
        submitted_at,
        updated_at,
        borrowers (
          id,
          borrower_name,
          entity_type,
          email,
          phone,
          ssn_ein_masked,
          state_of_residence,
          years_self_employed
        ),
        loan_requests (
          id,
          requested_amount,
          loan_purpose
        ),
        properties (
          id,
          address_street,
          address_city,
          address_state,
          address_zip,
          property_type,
          total_units,
          appraised_value,
          purchase_price
        ),
        documents:uploaded_documents (
          id,
          document_type,
          file_name,
          processing_status,
          file_path,
          created_at
        ),
        aggregated_bank_metrics (
          id,
          total_available_cash,
          avg_monthly_deposits,
          avg_monthly_withdrawals,
          avg_monthly_net_cash_flow
        ),
        pre_approvals!intake_submission_id (
          id,
          status,
          requested_loan_amount,
          verified_liquidity,
          required_liquidity,
          passes_liquidity_check,
          qualification_min,
          qualification_max,
          recommended_amount,
          conditions,
          machine_decision,
          machine_confidence,
          issued_at,
          expires_at
        )
      `)
      .eq('id', submissionId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching submission:', error);
    } else {
      setSubmission(data);
    }

    setLoading(false);
  }, [submissionId]);

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  const handleApprove = async () => {
    if (!submission) return;
    setUpdating(true);

    const { error } = await supabase
      .from('intake_submissions')
      .update({
        status: 'approved',
        processing_stage: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (error) {
      console.error('Error approving submission:', error);
      alert('Failed to approve application');
    } else {
      fetchSubmission();
    }

    setUpdating(false);
  };

  const handleDecline = async () => {
    if (!submission) return;
    setUpdating(true);

    const { error } = await supabase
      .from('intake_submissions')
      .update({
        status: 'declined',
        processing_stage: 'declined',
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (error) {
      console.error('Error declining submission:', error);
      alert('Failed to decline application');
    } else {
      setShowDeclineModal(false);
      fetchSubmission();
    }

    setUpdating(false);
  };

  const handleDownloadDocument = async (doc: SubmissionDetail['documents'][0]) => {
    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(doc.file_path, 3600);

      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document');
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Submission not found</p>
        <button onClick={onBack} className="mt-4 text-teal-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[submission.status] || STATUS_CONFIG.draft;
  const borrower = submission.borrowers;
  const loanRequest = submission.loan_requests?.[0];
  const property = submission.properties?.[0];
  const bankMetrics = submission.aggregated_bank_metrics?.[0];
  const preApproval = submission.pre_approvals?.[0] || null;
  const documents = submission.documents || [];

  const canApprove = submission.status === 'pending_review';
  const canDecline = submission.status === 'pending_review';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Application Review</h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
            </div>
            <p className="text-gray-500 mt-1">
              ID: {submission.id.slice(0, 8)}... | Submitted {formatDate(submission.submitted_at)}
            </p>
          </div>
        </div>

        {(canApprove || canDecline) && (
          <div className="flex items-center gap-3">
            {canDecline && (
              <button
                onClick={() => setShowDeclineModal(true)}
                disabled={updating}
                className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Decline
              </button>
            )}
            {canApprove && (
              <button
                onClick={handleApprove}
                disabled={updating}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {updating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Approve Application
              </button>
            )}
          </div>
        )}
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {[
            { key: 'overview', label: 'Overview', icon: Eye },
            { key: 'documents', label: 'Documents', icon: FileText },
            { key: 'financials', label: 'Financials', icon: Banknote },
            { key: 'rulebook', label: 'Lender Rulebook', icon: BookOpen },
            { key: 'placerbot', label: 'PlacerBot', icon: Bot },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-2 px-1 py-3 border-b-2 font-medium text-sm transition-colors ${
                  isActive
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.key === 'documents' && (
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                    {documents.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-gray-400" />
                Borrower Information
              </h2>
              {borrower ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-gray-500">Name</p>
                      <p className="font-medium text-gray-900">
                        {borrower.borrower_name || '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium text-gray-900 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-gray-400" />
                        {borrower.email || '-'}
                      </p>
                    </div>
                    {borrower.phone && (
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="font-medium text-gray-900 flex items-center gap-2">
                          <Phone className="w-4 h-4 text-gray-400" />
                          {borrower.phone}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-gray-500">Entity Type</p>
                      <p className="font-medium text-gray-900 capitalize">
                        {borrower.entity_type?.replace('_', ' ') || 'Individual'}
                      </p>
                    </div>
                    {borrower.state_of_residence && (
                      <div>
                        <p className="text-sm text-gray-500">State of Residence</p>
                        <p className="font-medium text-gray-900">{borrower.state_of_residence}</p>
                      </div>
                    )}
                    {borrower.ssn_ein_masked && (
                      <div>
                        <p className="text-sm text-gray-500">SSN/EIN</p>
                        <p className="font-medium text-gray-900">{borrower.ssn_ein_masked}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <User className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <p className="text-sm text-gray-600">
                    No borrower information available for this submission.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-gray-400" />
                Loan Details
              </h2>
              {loanRequest ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-gray-500">Requested Amount</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {formatCurrency(loanRequest.requested_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Loan Purpose</p>
                      <p className="font-medium text-gray-900">
                        {LOAN_TYPE_LABELS[loanRequest.loan_purpose || ''] || loanRequest.loan_purpose || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {property?.purchase_price && (
                      <div>
                        <p className="text-sm text-gray-500">Purchase Price</p>
                        <p className="font-medium text-gray-900">
                          {formatCurrency(property.purchase_price)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <p className="text-sm text-amber-800">
                    No loan details submitted yet. The borrower may have submitted documents without completing the loan request form.
                  </p>
                </div>
              )}
            </div>

            {property && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Home className="w-5 h-5 text-gray-400" />
                  Property Information
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-gray-500">Address</p>
                      <p className="font-medium text-gray-900">
                        {property.address_street}
                        <br />
                        {property.address_city}, {property.address_state} {property.address_zip}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Property Type</p>
                      <p className="font-medium text-gray-900">
                        {PROPERTY_TYPE_LABELS[property.property_type] || property.property_type}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {property.total_units && (
                      <div>
                        <p className="text-sm text-gray-500">Units</p>
                        <p className="font-medium text-gray-900">{property.total_units}</p>
                      </div>
                    )}
                    {property.appraised_value && (
                      <div>
                        <p className="text-sm text-gray-500">Appraised Value</p>
                        <p className="font-medium text-gray-900">
                          {formatCurrency(property.appraised_value)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {preApproval && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-teal-600" />
                  Pre-Approval Status
                </h3>
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg ${preApproval.passes_liquidity_check ? 'bg-green-50' : 'bg-amber-50'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {preApproval.passes_liquidity_check ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                      )}
                      <span className={`font-medium ${preApproval.passes_liquidity_check ? 'text-green-900' : 'text-amber-900'}`}>
                        {preApproval.passes_liquidity_check ? 'Liquidity Verified' : 'Liquidity Review Needed'}
                      </span>
                    </div>
                    {preApproval.verified_liquidity != null && preApproval.required_liquidity != null && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-gray-500">Verified</p>
                          <p className="font-semibold text-gray-900">{formatCurrency(preApproval.verified_liquidity)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Required</p>
                          <p className="font-semibold text-gray-900">{formatCurrency(preApproval.required_liquidity)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {preApproval.recommended_amount && (
                    <div>
                      <p className="text-sm text-gray-500">Recommended Amount</p>
                      <p className="text-xl font-bold text-teal-700">{formatCurrency(preApproval.recommended_amount)}</p>
                    </div>
                  )}
                  {preApproval.qualification_max && (
                    <div>
                      <p className="text-sm text-gray-500">Qualified Range</p>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(preApproval.qualification_min)} - {formatCurrency(preApproval.qualification_max)}
                      </p>
                    </div>
                  )}
                  {preApproval.machine_decision && (
                    <div>
                      <p className="text-sm text-gray-500">Machine Decision</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          preApproval.machine_decision === 'approve' ? 'bg-green-100 text-green-700' :
                          preApproval.machine_decision === 'decline' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {preApproval.machine_decision}
                        </span>
                        {preApproval.machine_confidence != null && (
                          <span className="text-xs text-gray-500">
                            {Math.round(preApproval.machine_confidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {preApproval.conditions && preApproval.conditions.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500 mb-2">Conditions</p>
                      <ul className="space-y-1">
                        {preApproval.conditions.map((condition: string, idx: number) => (
                          <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                            <span className="text-amber-500 mt-1">-</span>
                            {condition}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gray-400" />
                Timeline
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-900">{formatDate(submission.created_at)}</span>
                </div>
                {submission.submitted_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Submitted</span>
                    <span className="text-gray-900">{formatDate(submission.submitted_at)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Updated</span>
                  <span className="text-gray-900">{formatDate(submission.updated_at)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-400" />
                Quick Stats
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-600">Documents</span>
                  <span className="font-semibold text-gray-900">{documents.length}</span>
                </div>
                {bankMetrics && (
                  <>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Available Cash</span>
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(bankMetrics.total_available_cash)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Avg Monthly Deposits</span>
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(bankMetrics.avg_monthly_deposits)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Uploaded Documents</h2>
          </div>
          {documents.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium text-gray-700">No documents uploaded</p>
              <p className="text-sm mt-1">The borrower has not uploaded any documents for this application yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {documents.map((doc) => (
                <div key={doc.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{doc.file_name}</p>
                      <p className="text-sm text-gray-500">
                        {doc.document_type.replace(/_/g, ' ')} | Uploaded {formatDate(doc.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        doc.processing_status === 'processed'
                          ? 'bg-green-100 text-green-700'
                          : doc.processing_status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {doc.processing_status}
                    </span>
                    <button
                      onClick={() => handleDownloadDocument(doc)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'financials' && (
        <div className="space-y-6">
          {bankMetrics ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <Banknote className="w-5 h-5 text-gray-400" />
                Bank Account Summary
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-500 mb-1">Total Available Cash</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(bankMetrics.total_available_cash)}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-500 mb-1">Avg Monthly Deposits</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(bankMetrics.avg_monthly_deposits)}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-500 mb-1">Avg Monthly Withdrawals</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(bankMetrics.avg_monthly_withdrawals)}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-500 mb-1">Avg Net Cash Flow</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(bankMetrics.avg_monthly_net_cash_flow)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
              <Banknote className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No financial data available</p>
              <p className="text-sm mt-1">Bank statements have not been processed yet</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'rulebook' && (
        <LenderRulebookPanel submissionId={submissionId} />
      )}

      {activeTab === 'placerbot' && (
        <PlacerBotPanel
          submissionId={submissionId}
          loanData={{
            requestedAmount: loanRequest?.requested_amount,
            loanType: loanRequest?.loan_purpose || 'dscr',
            propertyState: property?.address_state,
            borrowerType: borrower?.entity_type === 'llc' || borrower?.entity_type === 'corporation' ? 'entity' : 'individual',
          }}
        />
      )}

      {showDeclineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Decline Application</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to decline this application? This action cannot be undone.
            </p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason for declining (optional)"
              className="w-full p-3 border border-gray-300 rounded-lg resize-none h-24 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeclineModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDecline}
                disabled={updating}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {updating && <Loader2 className="w-4 h-4 animate-spin" />}
                Decline Application
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
