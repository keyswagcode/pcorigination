import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, User, Building2, DollarSign, MapPin, Calendar, FileText, CheckCircle as CheckCircle2, Circle as XCircle, Clock, AlertTriangle, Download, Eye, Loader as Loader2, Phone, Mail, Hop as Home, Banknote, TrendingUp, Shield, Bot, RefreshCw, ExternalLink, Upload, AlertCircle, Search, ChevronDown, ChevronUp, Percent, CreditCard, History, FileCheck, Sparkles, Target, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTeam } from '../team/TeamContext';
import { PlacerBotPanel } from '../placerbot';

interface BorrowerManagementProps {
  submissionId: string;
  onBack: () => void;
}

interface NormalizedBankAccount {
  id: string;
  institution_name: string | null;
  account_number_last4: string | null;
  account_type: string | null;
  account_holder_name: string | null;
  beginning_balance: number | null;
  ending_balance: number | null;
  average_daily_balance: number | null;
  lowest_balance: number | null;
  highest_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  deposit_count: number | null;
  withdrawal_count: number | null;
  avg_monthly_deposits: number | null;
  avg_monthly_withdrawals: number | null;
  avg_monthly_balance: number | null;
  statement_start_date: string | null;
  statement_end_date: string | null;
  nsf_count: number | null;
  overdraft_count: number | null;
  returned_item_count: number | null;
  normalization_confidence: number | null;
  requires_manual_review: boolean;
  uploaded_document_id: string | null;
}

interface LegacyBankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  opening_balance: number | null;
  closing_balance: number | null;
  available_cash: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
  nsf_count: number | null;
  overdraft_count: number | null;
}

interface ExtractionAuditEntry {
  id: string;
  uploaded_document_id: string;
  field_name: string;
  normalized_field_name: string | null;
  raw_extracted_value: string | null;
  normalized_value: string | null;
  source_page: number | null;
  extraction_confidence: number | null;
  validation_status: string | null;
}

interface DocumentClassification {
  id: string;
  uploaded_document_id: string;
  detected_type: string;
  sub_type: string | null;
  classification_confidence: number | null;
  classification_method: string | null;
  is_confirmed: boolean;
  confirmed_type: string | null;
}

interface UploadedDocument {
  id: string;
  document_type: string;
  file_name: string;
  file_path: string;
  processing_status: string;
  extraction_status: string | null;
  extraction_confidence: number | null;
  created_at: string;
}

interface PreApproval {
  id: string;
  status: string;
  requested_loan_amount: number | null;
  recommended_amount: number | null;
  qualification_min: number | null;
  qualification_max: number | null;
  verified_liquidity: number | null;
  required_liquidity: number | null;
  passes_liquidity_check: boolean | null;
  conditions: string[] | null;
  machine_decision: string | null;
  machine_confidence: number | null;
  letter_number: string | null;
  created_at: string;
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
    state_of_residence: string | null;
    credit_score: number | null;
    real_estate_experience_years: number | null;
    properties_owned_count: number | null;
  } | null;
  loan_requests: Array<{
    id: string;
    requested_amount: number;
    loan_purpose: string;
    estimated_purchase_price: number | null;
    down_payment_amount: number | null;
    down_payment_source: string | null;
  }>;
  properties: Array<{
    id: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    property_type: string;
    occupancy_type: string | null;
    number_of_units: number | null;
    purchase_price: number | null;
    estimated_value: number | null;
    monthly_rent: number | null;
  }>;
}

type ActiveTab = 'overview' | 'documents' | 'financials' | 'pre-approval' | 'placerbot' | 'activity';

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
  dscr: 'DSCR / Rental',
  bridge: 'Bridge',
  fix_flip: 'Fix & Flip',
  construction: 'Construction',
  bank_statement: 'Bank Statement',
  commercial: 'Commercial',
};

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  single_family: 'Single Family',
  multifamily: 'Multifamily (2-4)',
  multifamily_5plus: 'Multifamily (5+)',
  condo: 'Condo',
  townhome: 'Townhome',
  mixed_use: 'Mixed Use',
  commercial: 'Commercial',
};

export function BorrowerManagement({ submissionId, onBack }: BorrowerManagementProps) {
  const { members } = useTeam();
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [normalizedAccounts, setNormalizedAccounts] = useState<NormalizedBankAccount[]>([]);
  const [legacyAccounts, setLegacyAccounts] = useState<LegacyBankAccount[]>([]);
  const [extractionAudit, setExtractionAudit] = useState<ExtractionAuditEntry[]>([]);
  const [documentClassifications, setDocumentClassifications] = useState<DocumentClassification[]>([]);
  const [preApprovals, setPreApprovals] = useState<PreApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [updating, setUpdating] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showAuditPanel, setShowAuditPanel] = useState<string | null>(null);

  const fetchAllData = useCallback(async () => {
    setLoading(true);

    const [
      submissionRes,
      docsRes,
      normalizedRes,
      legacyBankRes,
      auditRes,
      classificationsRes,
      preApprovalRes,
    ] = await Promise.all([
      supabase
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
            state_of_residence,
            credit_score,
            real_estate_experience_years,
            properties_owned_count
          ),
          loan_requests (
            id,
            requested_amount,
            loan_purpose,
            estimated_purchase_price,
            down_payment_amount,
            down_payment_source
          ),
          properties (
            id,
            address_street,
            address_city,
            address_state,
            address_zip,
            property_type,
            occupancy_type,
            number_of_units,
            purchase_price,
            estimated_value,
            monthly_rent
          )
        `)
        .eq('id', submissionId)
        .maybeSingle(),

      supabase
        .from('uploaded_documents')
        .select('*')
        .eq('intake_submission_id', submissionId)
        .order('created_at', { ascending: false }),

      supabase
        .from('normalized_bank_accounts')
        .select('*')
        .eq('intake_submission_id', submissionId)
        .order('statement_start_date', { ascending: false }),

      supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', submissionId)
        .order('statement_period_start', { ascending: false }),

      supabase
        .from('extraction_audit_log')
        .select('*')
        .in('uploaded_document_id', (await supabase
          .from('uploaded_documents')
          .select('id')
          .eq('intake_submission_id', submissionId)
        ).data?.map(d => d.id) || [])
        .order('extraction_timestamp', { ascending: false }),

      supabase
        .from('document_classifications')
        .select('*')
        .in('uploaded_document_id', (await supabase
          .from('uploaded_documents')
          .select('id')
          .eq('intake_submission_id', submissionId)
        ).data?.map(d => d.id) || []),

      supabase
        .from('pre_approvals')
        .select('*')
        .eq('intake_submission_id', submissionId)
        .order('created_at', { ascending: false }),
    ]);

    if (submissionRes.data) {
      setSubmission(submissionRes.data);
    }
    setDocuments(docsRes.data || []);
    setNormalizedAccounts(normalizedRes.data || []);
    setLegacyAccounts(legacyBankRes.data || []);
    setExtractionAudit(auditRes.data || []);
    setDocumentClassifications(classificationsRes.data || []);
    setPreApprovals(preApprovalRes.data || []);
    setLoading(false);
  }, [submissionId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleApprove = async () => {
    if (!submission) return;
    setUpdating(true);

    await supabase
      .from('intake_submissions')
      .update({
        status: 'approved',
        processing_stage: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    fetchAllData();
    setUpdating(false);
  };

  const handleDecline = async () => {
    if (!submission) return;
    setUpdating(true);

    await supabase
      .from('intake_submissions')
      .update({
        status: 'declined',
        processing_stage: 'declined',
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    setShowDeclineModal(false);
    fetchAllData();
    setUpdating(false);
  };

  const handleMoveToUnderwriting = async () => {
    if (!submission) return;
    setUpdating(true);

    await supabase
      .from('intake_submissions')
      .update({
        status: 'processing',
        processing_stage: 'underwriting',
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    fetchAllData();
    setUpdating(false);
  };

  const handleDownloadDocument = async (doc: UploadedDocument) => {
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
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
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

  const formatDateRange = (start: string | null, end: string | null) => {
    if (!start || !end) return '-';
    const startDate = new Date(start);
    const endDate = new Date(end);
    return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
  const latestPreApproval = preApprovals[0];

  const canApprove = submission.status === 'pending_review';
  const canDecline = submission.status === 'pending_review';
  const canMoveToUnderwriting = submission.status === 'approved';

  const useNormalizedData = normalizedAccounts.length > 0;
  const accountCount = useNormalizedData ? normalizedAccounts.length : legacyAccounts.length;

  const totalAvailableCash = useNormalizedData
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.ending_balance || 0), 0)
    : legacyAccounts.reduce((sum, acc) => sum + (acc.available_cash || 0), 0);

  const totalDeposits = useNormalizedData
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.total_deposits || 0), 0)
    : legacyAccounts.reduce((sum, acc) => sum + (acc.total_deposits || 0), 0);

  const totalWithdrawals = useNormalizedData
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.total_withdrawals || 0), 0)
    : legacyAccounts.reduce((sum, acc) => sum + (acc.total_withdrawals || 0), 0);

  const totalNsf = useNormalizedData
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.nsf_count || 0), 0)
    : legacyAccounts.reduce((sum, acc) => sum + (acc.nsf_count || 0), 0);

  const totalOverdrafts = useNormalizedData
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.overdraft_count || 0), 0)
    : legacyAccounts.reduce((sum, acc) => sum + (acc.overdraft_count || 0), 0);

  const avgNormalizationConfidence = useNormalizedData && normalizedAccounts.length > 0
    ? normalizedAccounts.reduce((sum, acc) => sum + (acc.normalization_confidence || 0), 0) / normalizedAccounts.length
    : null;

  const requiresManualReview = normalizedAccounts.some(acc => acc.requires_manual_review);

  const getDocumentClassification = (docId: string) => {
    return documentClassifications.find(c => c.uploaded_document_id === docId);
  };

  const getDocumentAuditEntries = (docId: string) => {
    return extractionAudit.filter(e => e.uploaded_document_id === docId);
  };

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: Eye },
    { key: 'documents' as const, label: 'Documents', icon: FileText, count: documents.length },
    { key: 'financials' as const, label: 'Financials', icon: Banknote, count: accountCount },
    { key: 'pre-approval' as const, label: 'Pre-Approval', icon: Shield, count: preApprovals.length },
    { key: 'placerbot' as const, label: 'PlacerBot', icon: Bot },
    { key: 'activity' as const, label: 'Activity', icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors mt-1"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">
                {borrower?.borrower_name || borrower?.email?.split('@')[0] || 'Borrower'}
              </h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              {borrower?.email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-4 h-4" />
                  {borrower.email}
                </span>
              )}
              {borrower?.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-4 h-4" />
                  {borrower.phone}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Submitted {formatDate(submission.submitted_at || submission.created_at)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchAllData}
            disabled={loading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canMoveToUnderwriting && (
            <button
              onClick={handleMoveToUnderwriting}
              disabled={updating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4" />
              Move to Underwriting
            </button>
          )}
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
              Approve
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500 mb-1">Loan Amount</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(loanRequest?.requested_amount)}</p>
          <p className="text-xs text-gray-400 mt-1">{LOAN_TYPE_LABELS[loanRequest?.loan_purpose || ''] || loanRequest?.loan_purpose}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500 mb-1">Verified Liquidity</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalAvailableCash)}</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-gray-400">{accountCount} statement(s)</p>
            {useNormalizedData && (
              <span className="px-1.5 py-0.5 text-xs bg-teal-100 text-teal-700 rounded">Normalized</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500 mb-1">Pre-Approval Status</p>
          <div className="flex items-center gap-2">
            {latestPreApproval?.passes_liquidity_check ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <span className="text-lg font-semibold text-green-700">Passed</span>
              </>
            ) : latestPreApproval ? (
              <>
                <AlertTriangle className="w-6 h-6 text-amber-600" />
                <span className="text-lg font-semibold text-amber-700">Review</span>
              </>
            ) : (
              <span className="text-lg font-semibold text-gray-400">Pending</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500 mb-1">Documents</p>
          <p className="text-2xl font-bold text-gray-900">{documents.length}</p>
          <p className="text-xs text-gray-400 mt-1">
            {documents.filter(d => d.processing_status === 'completed').length} processed
          </p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
                  isActive
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`px-1.5 py-0.5 text-xs rounded ${isActive ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600'}`}>
                    {tab.count}
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
                {borrower?.entity_type === 'llc' || borrower?.entity_type === 'corporation' ? (
                  <Building2 className="w-5 h-5 text-gray-400" />
                ) : (
                  <User className="w-5 h-5 text-gray-400" />
                )}
                Borrower Information
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-medium text-gray-900">
                      {borrower?.borrower_name || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Entity Type</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {borrower?.entity_type?.replace('_', ' ') || 'Individual'}
                    </p>
                  </div>
                  {borrower?.credit_score && (
                    <div>
                      <p className="text-sm text-gray-500">Credit Score</p>
                      <p className="font-medium text-gray-900 flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-gray-400" />
                        {borrower.credit_score}
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  {borrower?.state_of_residence && (
                    <div>
                      <p className="text-sm text-gray-500">State of Residence</p>
                      <p className="font-medium text-gray-900">{borrower.state_of_residence}</p>
                    </div>
                  )}
                  {borrower?.real_estate_experience_years !== null && borrower?.real_estate_experience_years !== undefined && (
                    <div>
                      <p className="text-sm text-gray-500">RE Experience</p>
                      <p className="font-medium text-gray-900">{borrower.real_estate_experience_years} years</p>
                    </div>
                  )}
                  {borrower?.properties_owned_count !== null && borrower?.properties_owned_count !== undefined && (
                    <div>
                      <p className="text-sm text-gray-500">Properties Owned</p>
                      <p className="font-medium text-gray-900">{borrower.properties_owned_count}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-gray-400" />
                Loan Details
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Requested Amount</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatCurrency(loanRequest?.requested_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Loan Type</p>
                    <p className="font-medium text-gray-900">
                      {LOAN_TYPE_LABELS[loanRequest?.loan_purpose || ''] || loanRequest?.loan_purpose || '-'}
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  {(property?.purchase_price || loanRequest?.estimated_purchase_price) && (
                    <div>
                      <p className="text-sm text-gray-500">Purchase Price</p>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(property?.purchase_price || loanRequest?.estimated_purchase_price)}
                      </p>
                    </div>
                  )}
                  {loanRequest?.requested_amount && (property?.purchase_price || loanRequest?.estimated_purchase_price) && (
                    <div>
                      <p className="text-sm text-gray-500">LTV</p>
                      <p className="font-medium text-gray-900">
                        {(
                          (loanRequest.requested_amount /
                            (property?.purchase_price || loanRequest.estimated_purchase_price || 1)) *
                          100
                        ).toFixed(1)}
                        %
                      </p>
                    </div>
                  )}
                  {loanRequest?.down_payment_amount && (
                    <div>
                      <p className="text-sm text-gray-500">Down Payment</p>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(loanRequest.down_payment_amount)}
                        {loanRequest.down_payment_source && (
                          <span className="text-sm text-gray-500 ml-2">
                            ({loanRequest.down_payment_source})
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
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
                    {property.occupancy_type && (
                      <div>
                        <p className="text-sm text-gray-500">Occupancy</p>
                        <p className="font-medium text-gray-900 capitalize">
                          {property.occupancy_type.replace(/_/g, ' ')}
                        </p>
                      </div>
                    )}
                    {property.number_of_units && (
                      <div>
                        <p className="text-sm text-gray-500">Units</p>
                        <p className="font-medium text-gray-900">{property.number_of_units}</p>
                      </div>
                    )}
                    {property.monthly_rent && (
                      <div>
                        <p className="text-sm text-gray-500">Monthly Rent</p>
                        <p className="font-medium text-gray-900">{formatCurrency(property.monthly_rent)}/mo</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {latestPreApproval && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-teal-600" />
                  Pre-Approval Summary
                </h3>
                <div className="space-y-4">
                  <div
                    className={`p-4 rounded-lg ${
                      latestPreApproval.passes_liquidity_check ? 'bg-green-50' : 'bg-amber-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {latestPreApproval.passes_liquidity_check ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                      )}
                      <span
                        className={`font-medium ${
                          latestPreApproval.passes_liquidity_check ? 'text-green-900' : 'text-amber-900'
                        }`}
                      >
                        {latestPreApproval.passes_liquidity_check ? 'Liquidity Verified' : 'Liquidity Review Needed'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-gray-500">Verified</p>
                        <p className="font-medium">{formatCurrency(latestPreApproval.verified_liquidity)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Required</p>
                        <p className="font-medium">{formatCurrency(latestPreApproval.required_liquidity)}</p>
                      </div>
                    </div>
                  </div>
                  {latestPreApproval.qualification_max && (
                    <div>
                      <p className="text-sm text-gray-500">Qualified Range</p>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(latestPreApproval.qualification_min)} -{' '}
                        {formatCurrency(latestPreApproval.qualification_max)}
                      </p>
                    </div>
                  )}
                  {latestPreApproval.machine_confidence !== null && (
                    <div>
                      <p className="text-sm text-gray-500">Confidence Score</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              latestPreApproval.machine_confidence >= 0.8
                                ? 'bg-green-500'
                                : latestPreApproval.machine_confidence >= 0.5
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${(latestPreApproval.machine_confidence || 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {Math.round((latestPreApproval.machine_confidence || 0) * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Banknote className="w-5 h-5 text-gray-400" />
                Financial Summary
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-600">Available Cash</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(totalAvailableCash)}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-600">Avg Deposits</span>
                  <span className="font-semibold text-green-600">
                    +{formatCurrency(accountCount > 0 ? totalDeposits / accountCount : 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-gray-600">Avg Withdrawals</span>
                  <span className="font-semibold text-red-600">
                    -{formatCurrency(accountCount > 0 ? totalWithdrawals / accountCount : 0)}
                  </span>
                </div>
                {(totalNsf > 0 || totalOverdrafts > 0) && (
                  <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <span className="text-red-700">NSF/Overdrafts</span>
                    <span className="font-semibold text-red-700">{totalNsf + totalOverdrafts}</span>
                  </div>
                )}
              </div>
            </div>

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
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Uploaded Documents ({documents.length})</h2>
              {documentClassifications.length > 0 && (
                <span className="px-2.5 py-1 bg-teal-50 text-teal-700 text-xs font-medium rounded-full">
                  {documentClassifications.filter(c => c.is_confirmed).length}/{documentClassifications.length} classified
                </span>
              )}
            </div>
            {documents.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No documents uploaded</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {documents.map((doc) => {
                  const isExpanded = expandedDoc === doc.id;
                  const confidencePercent = doc.extraction_confidence ? Math.round(doc.extraction_confidence * 100) : null;
                  const classification = getDocumentClassification(doc.id);
                  const auditEntries = getDocumentAuditEntries(doc.id);
                  const showingAudit = showAuditPanel === doc.id;

                  return (
                    <div key={doc.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-gray-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{doc.file_name}</p>
                            <div className="flex items-center gap-3 text-sm text-gray-500">
                              <span className="capitalize">{doc.document_type.replace(/_/g, ' ')}</span>
                              {classification && (
                                <span className="flex items-center gap-1">
                                  <span className="text-teal-600">
                                    {classification.detected_type.replace(/_/g, ' ')}
                                  </span>
                                  {classification.classification_confidence && (
                                    <span className="text-xs text-gray-400">
                                      ({Math.round(classification.classification_confidence * 100)}%)
                                    </span>
                                  )}
                                </span>
                              )}
                              <span>Uploaded {formatDate(doc.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                              doc.processing_status === 'completed'
                                ? 'bg-green-100 text-green-700'
                                : doc.processing_status === 'processing'
                                ? 'bg-blue-100 text-blue-700'
                                : doc.processing_status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {doc.processing_status}
                          </span>
                          {confidencePercent !== null && (
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                confidencePercent >= 80
                                  ? 'bg-green-100 text-green-700'
                                  : confidencePercent >= 50
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {confidencePercent}% confidence
                            </span>
                          )}
                          {auditEntries.length > 0 && (
                            <button
                              onClick={() => setShowAuditPanel(showingAudit ? null : doc.id)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                showingAudit
                                  ? 'bg-teal-600 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              Audit ({auditEntries.length})
                            </button>
                          )}
                          <button
                            onClick={() => handleDownloadDocument(doc)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Download"
                          >
                            <Download className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-gray-600" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-600" />
                            )}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 ml-16 space-y-4">
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500">Document ID</p>
                                <p className="font-mono text-gray-900 text-xs">{doc.id}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">File Path</p>
                                <p className="font-mono text-gray-900 text-xs truncate">{doc.file_path}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Processing Status</p>
                                <p className="text-gray-900 capitalize">{doc.processing_status}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Extraction Status</p>
                                <p className="text-gray-900 capitalize">{doc.extraction_status || 'N/A'}</p>
                              </div>
                            </div>
                          </div>

                          {classification && (
                            <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg">
                              <h4 className="font-medium text-teal-900 mb-2">Document Classification</h4>
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="text-teal-700">Detected Type</p>
                                  <p className="font-medium text-teal-900 capitalize">
                                    {classification.detected_type.replace(/_/g, ' ')}
                                    {classification.sub_type && ` (${classification.sub_type})`}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-teal-700">Confidence</p>
                                  <p className="font-medium text-teal-900">
                                    {classification.classification_confidence
                                      ? `${Math.round(classification.classification_confidence * 100)}%`
                                      : 'N/A'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-teal-700">Method</p>
                                  <p className="font-medium text-teal-900 capitalize">
                                    {classification.classification_method?.replace(/_/g, ' ') || 'Auto'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {showingAudit && auditEntries.length > 0 && (
                        <div className="mt-4 ml-16">
                          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                              <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                                <Eye className="w-4 h-4 text-teal-600" />
                                Extraction Audit Trail
                              </h4>
                              <p className="text-xs text-gray-500 mt-1">
                                Field-level extraction details with source page references
                              </p>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-gray-50 text-left">
                                    <th className="px-4 py-2 font-medium text-gray-600">Field</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Extracted Value</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Normalized Value</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Page</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Confidence</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {auditEntries.map((entry) => (
                                    <tr key={entry.id} className="hover:bg-gray-50">
                                      <td className="px-4 py-2">
                                        <span className="font-medium text-gray-900">{entry.field_name}</span>
                                        {entry.normalized_field_name && entry.normalized_field_name !== entry.field_name && (
                                          <span className="block text-xs text-teal-600">
                                            {entry.normalized_field_name}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 font-mono text-xs text-gray-700">
                                        {entry.raw_extracted_value || '-'}
                                      </td>
                                      <td className="px-4 py-2 font-mono text-xs text-teal-700 font-medium">
                                        {entry.normalized_value || '-'}
                                      </td>
                                      <td className="px-4 py-2 text-gray-600">
                                        {entry.source_page ? `Page ${entry.source_page}` : '-'}
                                      </td>
                                      <td className="px-4 py-2">
                                        {entry.extraction_confidence !== null ? (
                                          <span
                                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                                              entry.extraction_confidence >= 0.8
                                                ? 'bg-green-100 text-green-700'
                                                : entry.extraction_confidence >= 0.5
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-red-100 text-red-700'
                                            }`}
                                          >
                                            {Math.round(entry.extraction_confidence * 100)}%
                                          </span>
                                        ) : (
                                          '-'
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        <span
                                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                                            entry.validation_status === 'validated'
                                              ? 'bg-green-100 text-green-700'
                                              : entry.validation_status === 'corrected'
                                              ? 'bg-blue-100 text-blue-700'
                                              : entry.validation_status === 'rejected'
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-gray-100 text-gray-600'
                                          }`}
                                        >
                                          {entry.validation_status || 'pending'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'financials' && (
        <div className="space-y-6">
          {useNormalizedData && (
            <div className={`p-4 rounded-xl border ${requiresManualReview ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {requiresManualReview ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-teal-600" />
                  )}
                  <div>
                    <p className={`font-medium ${requiresManualReview ? 'text-amber-900' : 'text-teal-900'}`}>
                      {requiresManualReview ? 'Manual Review Required' : 'Data Normalized'}
                    </p>
                    <p className={`text-sm ${requiresManualReview ? 'text-amber-700' : 'text-teal-700'}`}>
                      Financial data has been processed through the normalization layer
                    </p>
                  </div>
                </div>
                {avgNormalizationConfidence !== null && (
                  <div className="text-right">
                    <p className={`text-sm ${requiresManualReview ? 'text-amber-700' : 'text-teal-700'}`}>
                      Avg Confidence
                    </p>
                    <p className={`text-xl font-bold ${requiresManualReview ? 'text-amber-900' : 'text-teal-900'}`}>
                      {Math.round(avgNormalizationConfidence * 100)}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Banknote className="w-5 h-5" />
                <span className="text-sm">Total Available Cash</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalAvailableCash)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-sm">Total Deposits</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(totalDeposits)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <TrendingUp className="w-5 h-5 text-red-500 rotate-180" />
                <span className="text-sm">Total Withdrawals</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(totalWithdrawals)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-sm">NSF/Overdrafts</span>
              </div>
              <p className={`text-2xl font-bold ${totalNsf + totalOverdrafts > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {totalNsf + totalOverdrafts}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Bank Statement Details ({accountCount} statements)
              </h2>
              {useNormalizedData && (
                <span className="px-2.5 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">
                  Normalized Data
                </span>
              )}
            </div>
            {accountCount === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <Banknote className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No bank statement data extracted</p>
                <p className="text-sm mt-1">Bank statements have not been processed yet</p>
              </div>
            ) : useNormalizedData ? (
              <div className="divide-y divide-gray-100">
                {normalizedAccounts.map((account) => (
                  <div key={account.id} className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">
                            {account.institution_name || 'Unknown Bank'}
                          </p>
                          {account.requires_manual_review && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                              Review Required
                            </span>
                          )}
                          {account.normalization_confidence !== null && (
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                account.normalization_confidence >= 0.8
                                  ? 'bg-green-100 text-green-700'
                                  : account.normalization_confidence >= 0.5
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {Math.round(account.normalization_confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {account.account_type?.replace(/_/g, ' ').toUpperCase() || 'Checking'}
                          {account.account_number_last4 && ` ****${account.account_number_last4}`} |{' '}
                          {formatDateRange(account.statement_start_date, account.statement_end_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Ending Balance</p>
                        <p className="text-xl font-bold text-teal-700">{formatCurrency(account.ending_balance)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-6 gap-3 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Beginning</p>
                        <p className="font-medium text-gray-900">{formatCurrency(account.beginning_balance)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Ending</p>
                        <p className="font-medium text-gray-900">{formatCurrency(account.ending_balance)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Avg Daily</p>
                        <p className="font-medium text-gray-900">{formatCurrency(account.average_daily_balance)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Deposits</p>
                        <p className="font-medium text-green-600">+{formatCurrency(account.total_deposits)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">Withdrawals</p>
                        <p className="font-medium text-red-600">-{formatCurrency(account.total_withdrawals)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs">NSF/OD</p>
                        <p
                          className={`font-medium ${
                            (account.nsf_count || 0) + (account.overdraft_count || 0) > 0
                              ? 'text-red-600'
                              : 'text-gray-900'
                          }`}
                        >
                          {(account.nsf_count || 0) + (account.overdraft_count || 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {legacyAccounts.map((account) => (
                  <div key={account.id} className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="font-semibold text-gray-900">{account.bank_name || 'Unknown Bank'}</p>
                        <p className="text-sm text-gray-500">
                          {account.account_type?.replace(/_/g, ' ').toUpperCase() || 'Checking'} |{' '}
                          {formatDateRange(account.statement_period_start, account.statement_period_end)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Available Cash</p>
                        <p className="text-xl font-bold text-teal-700">{formatCurrency(account.available_cash)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500">Opening</p>
                        <p className="font-medium text-gray-900">{formatCurrency(account.opening_balance)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500">Closing</p>
                        <p className="font-medium text-gray-900">{formatCurrency(account.closing_balance)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500">Deposits</p>
                        <p className="font-medium text-green-600">+{formatCurrency(account.total_deposits)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500">Withdrawals</p>
                        <p className="font-medium text-red-600">-{formatCurrency(account.total_withdrawals)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500">NSF/OD</p>
                        <p
                          className={`font-medium ${
                            (account.nsf_count || 0) + (account.overdraft_count || 0) > 0
                              ? 'text-red-600'
                              : 'text-gray-900'
                          }`}
                        >
                          {(account.nsf_count || 0) + (account.overdraft_count || 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'pre-approval' && (
        <div className="space-y-6">
          {preApprovals.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
              <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No pre-approval generated yet</p>
              <p className="text-sm mt-1">Pre-approval will be available after document processing</p>
            </div>
          ) : (
            preApprovals.map((pa, idx) => (
              <div key={pa.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div
                  className={`px-6 py-4 ${
                    pa.passes_liquidity_check
                      ? 'bg-gradient-to-r from-green-600 to-green-700'
                      : 'bg-gradient-to-r from-amber-500 to-amber-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {pa.passes_liquidity_check ? (
                        <CheckCircle2 className="w-8 h-8 text-white" />
                      ) : (
                        <AlertTriangle className="w-8 h-8 text-white" />
                      )}
                      <div>
                        <h3 className="text-xl font-bold text-white">
                          {pa.passes_liquidity_check ? 'Pre-Approved' : 'Conditional Pre-Approval'}
                        </h3>
                        <p className="text-white/80">
                          {pa.letter_number && `Letter #${pa.letter_number} | `}
                          Generated {formatDate(pa.created_at)}
                          {idx === 0 && ' (Latest)'}
                        </p>
                      </div>
                    </div>
                    {pa.machine_confidence !== null && (
                      <div className="text-right">
                        <p className="text-white/80 text-sm">Confidence</p>
                        <p className="text-2xl font-bold text-white">
                          {Math.round((pa.machine_confidence || 0) * 100)}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="grid md:grid-cols-3 gap-6 text-center">
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-1">Requested Amount</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCurrency(pa.requested_loan_amount)}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-1">Recommended Amount</p>
                      <p className="text-2xl font-bold text-teal-700">{formatCurrency(pa.recommended_amount)}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-1">Qualification Range</p>
                      <p className="text-lg font-bold text-gray-900">
                        {formatCurrency(pa.qualification_min)} - {formatCurrency(pa.qualification_max)}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`rounded-xl p-4 ${
                      pa.passes_liquidity_check ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'
                    }`}
                  >
                    <h4
                      className={`font-semibold mb-3 ${pa.passes_liquidity_check ? 'text-green-900' : 'text-amber-900'}`}
                    >
                      Liquidity Verification
                    </h4>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className={`text-sm ${pa.passes_liquidity_check ? 'text-green-700' : 'text-amber-700'}`}>
                          Verified Liquidity
                        </p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(pa.verified_liquidity)}</p>
                      </div>
                      <div>
                        <p className={`text-sm ${pa.passes_liquidity_check ? 'text-green-700' : 'text-amber-700'}`}>
                          Required Liquidity
                        </p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(pa.required_liquidity)}</p>
                      </div>
                      <div>
                        <p className={`text-sm ${pa.passes_liquidity_check ? 'text-green-700' : 'text-amber-700'}`}>
                          Status
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            pa.passes_liquidity_check ? 'text-green-600' : 'text-amber-600'
                          }`}
                        >
                          {pa.passes_liquidity_check ? 'PASS' : 'REVIEW'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {pa.conditions && pa.conditions.length > 0 && (
                    <div className="border border-gray-200 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        Conditions ({pa.conditions.length})
                      </h4>
                      <ul className="space-y-2">
                        {pa.conditions.map((condition, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <span className="w-5 h-5 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">
                              {i + 1}
                            </span>
                            {condition}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {pa.machine_decision && (
                    <div className="border border-gray-200 rounded-xl p-4">
                      <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                        <Bot className="w-5 h-5 text-teal-600" />
                        Machine Decision
                      </h4>
                      <p className="text-gray-700 capitalize">{pa.machine_decision.replace(/_/g, ' ')}</p>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'placerbot' && (
        <PlacerBotPanel
          submissionId={submissionId}
          loanData={{
            loanType: loanRequest?.loan_purpose || 'dscr',
            requestedAmount: loanRequest?.requested_amount || 500000,
            propertyState: property?.address_state || 'CA',
            borrowerType:
              borrower?.entity_type === 'llc' || borrower?.entity_type === 'corporation' ? 'entity' : 'individual',
          }}
        />
      )}

      {activeTab === 'activity' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Activity Log</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Application created</p>
                  <p className="text-xs text-gray-500">{formatDate(submission.created_at)}</p>
                </div>
              </div>
              {submission.submitted_at && (
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                    <Upload className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-900">Application submitted</p>
                    <p className="text-xs text-gray-500">{formatDate(submission.submitted_at)}</p>
                  </div>
                </div>
              )}
              {documents.length > 0 && (
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <FileCheck className="w-4 h-4 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-900">{documents.length} document(s) uploaded</p>
                    <p className="text-xs text-gray-500">{formatDate(documents[0]?.created_at)}</p>
                  </div>
                </div>
              )}
              {preApprovals.length > 0 && (
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-900">Pre-approval generated</p>
                    <p className="text-xs text-gray-500">{formatDate(preApprovals[0]?.created_at)}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Last updated</p>
                  <p className="text-xs text-gray-500">{formatDate(submission.updated_at)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
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
