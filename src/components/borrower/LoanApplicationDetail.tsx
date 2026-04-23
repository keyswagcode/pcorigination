import { useState, useEffect } from 'react';
import {
  ArrowLeft, FileText, Calendar, Home, DollarSign, Clock, CheckCircle,
  XCircle, AlertCircle, Download, Upload, Eye, Building, TrendingUp,
  CreditCard, User, MapPin, Percent, Timer, RefreshCw, ExternalLink, Trash2,
  Loader as Loader2, Landmark, ArrowDownCircle, ArrowUpCircle, Play
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { generatePreApprovalPdfHtml, downloadPdf, fetchOrgBrandingForBorrower } from '../../lib/pdfGenerator';

interface LoanApplicationFull {
  id: string;
  status: string;
  processing_stage: string;
  created_at: string;
  updated_at: string;
  loan_request: {
    requested_amount: number;
    loan_type: string;
    loan_purpose: string;
    term_months: number;
    interest_type: string;
    exit_strategy: string;
    amortization_type: string;
    requested_rate: number;
    use_of_proceeds: string;
  } | null;
  property: {
    id: string;
    property_address: string;
    property_type: string;
    estimated_value: number;
    property_city: string;
    property_state: string;
    property_zip: string;
    square_footage: number;
    year_built: number;
    number_of_units: number;
  } | null;
  pre_approval: {
    id: string;
    status: string;
    recommended_amount: number;
    qualification_min: number;
    qualification_max: number;
    passes_liquidity_check: boolean;
    created_at: string;
    estimated_rate_min: number;
    estimated_rate_max: number;
    requested_loan_amount: number;
    verified_liquidity: number;
    required_liquidity: number;
    borrower_type: string;
    loan_type: string;
    estimated_purchase_price: number;
    property_state: string;
    conditions: string[];
    expires_at: string;
    letter_number: string;
  } | null;
  documents: {
    id: string;
    file_name: string;
    file_path: string;
    file_size_bytes: number;
    document_type: string;
    processing_status: string;
    extraction_status: string;
    created_at: string;
  }[];
  borrower: {
    borrower_name: string;
    email: string;
    phone: string;
    credit_score: number;
  } | null;
}

interface BankStatementAccount {
  id: string;
  bank_name: string;
  account_type: string;
  account_holder_name: string;
  statement_period_start: string;
  statement_period_end: string;
  opening_balance: number;
  closing_balance: number;
  available_cash: number;
  total_deposits: number;
  total_withdrawals: number;
  deposit_count: number;
  withdrawal_count: number;
  extraction_confidence: number;
  created_at: string;
}

interface Props {
  applicationId: string;
  source?: 'intake' | 'application';
  initialTab?: string;
  onBack: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: typeof CheckCircle }> = {
  draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-600', icon: FileText },
  pending_review: { label: 'Under Review', bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
  processing: { label: 'Processing', bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock },
  approved: { label: 'Approved', bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
  declined: { label: 'Declined', bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
};

const DOC_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pending', bg: 'bg-amber-100', text: 'text-amber-700' },
  processing: { label: 'Processing', bg: 'bg-blue-100', text: 'text-blue-700' },
  completed: { label: 'Completed', bg: 'bg-green-100', text: 'text-green-700' },
  failed: { label: 'Failed', bg: 'bg-red-100', text: 'text-red-700' },
};

const STAGE_TIMELINE = [
  { id: 'submitted', label: 'Application Submitted', icon: FileText },
  { id: 'documents', label: 'Documents Uploaded', icon: Upload },
  { id: 'processing', label: 'Documents Processing', icon: RefreshCw },
  { id: 'review', label: 'Under Review', icon: Eye },
  { id: 'pre_approval', label: 'Pre-Approval Decision', icon: CheckCircle },
];

const STAGE_LABELS: Record<string, string> = {
  documents_uploading: 'Upload Documents',
  documents_uploaded: 'Documents Uploaded',
  documents_processing: 'Documents Processing',
  documents_processed: 'Documents Analyzed',
  documents_failed: 'Processing Failed',
  pre_approval_complete: 'Pre-Approval Complete',
  submitted_for_review: 'Submitted for Review',
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  dscr: 'DSCR Loan',
  fix_flip: 'Fix & Flip',
  bridge: 'Bridge Loan',
  construction: 'Construction',
  commercial: 'Commercial',
  rental: 'Rental Property',
  mixed_use: 'Mixed Use',
  multifamily: 'Multifamily',
};

export function LoanApplicationDetail({ applicationId, source = 'intake', initialTab, onBack }: Props) {
  const { user } = useAuth();
  const [application, setApplication] = useState<LoanApplicationFull | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankStatementAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'financials' | 'timeline'>(
    (initialTab as 'overview' | 'documents' | 'financials' | 'timeline') || 'overview'
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  useEffect(() => {
    if (user && applicationId) {
      fetchApplicationDetail();
    }
  }, [user, applicationId, source]);

  const fetchApplicationDetail = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      if (source === 'application') {
        const { data: loanApp, error } = await supabase
          .from('loan_applications')
          .select('*')
          .eq('id', applicationId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (!loanApp) {
          setApplication(null);
          return;
        }

        const mapped: LoanApplicationFull = {
          id: loanApp.id,
          status: loanApp.current_stage || 'pending',
          processing_stage: loanApp.current_stage || 'pending',
          created_at: loanApp.created_at,
          updated_at: loanApp.updated_at,
          loan_request: {
            requested_amount: loanApp.requested_amount,
            loan_type: loanApp.loan_type,
            loan_purpose: loanApp.loan_purpose,
            term_months: loanApp.term_months,
            interest_type: loanApp.interest_type,
            exit_strategy: loanApp.exit_strategy,
            amortization_type: loanApp.amortization_type,
            requested_rate: loanApp.requested_rate,
            use_of_proceeds: loanApp.use_of_proceeds,
          },
          property: loanApp.property_address ? {
            id: '',
            property_address: loanApp.property_address,
            property_type: loanApp.property_type,
            estimated_value: loanApp.estimated_value || 0,
            property_city: loanApp.property_city || '',
            property_state: loanApp.property_state || '',
            property_zip: loanApp.property_zip || '',
            square_footage: loanApp.square_footage || 0,
            year_built: loanApp.year_built || 0,
            number_of_units: loanApp.number_of_units || 0,
          } : null,
          pre_approval: loanApp.pre_approval_status ? {
            id: '',
            status: loanApp.pre_approval_status,
            recommended_amount: loanApp.pre_approval_amount || 0,
            qualification_min: loanApp.pre_approval_amount || 0,
            qualification_max: loanApp.pre_approval_amount || 0,
            passes_liquidity_check: true,
            created_at: loanApp.updated_at,
            estimated_rate_min: 0,
            estimated_rate_max: 0,
          } : null,
          documents: [],
          borrower: null,
        };

        setApplication(mapped);
        return;
      }

      const { data: submission, error } = await supabase
        .from('intake_submissions')
        .select(`
          id,
          status,
          processing_stage,
          created_at,
          updated_at,
          borrower_id,
          loan_requests (
            requested_amount,
            loan_purpose,
            term_months,
            interest_type,
            exit_strategy,
            amortization_type,
            requested_rate,
            use_of_proceeds
          ),
          properties (
            id,
            address_street,
            property_type,
            purchase_price,
            address_city,
            address_state,
            address_zip,
            total_sqft,
            year_built,
            total_units
          ),
          uploaded_documents (
            id,
            file_name,
            file_path,
            file_size_bytes,
            document_type,
            processing_status,
            extraction_status,
            created_at
          )
        `)
        .eq('id', applicationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!submission) {
        setApplication(null);
        return;
      }

      let borrowerData = null;
      if (submission.borrower_id) {
        const { data: borrower } = await supabase
          .from('borrowers')
          .select('borrower_name, email, phone, credit_score')
          .eq('id', submission.borrower_id)
          .maybeSingle();
        borrowerData = borrower;
      }

      const { data: preApprovalData } = await supabase
        .from('pre_approvals')
        .select(`
          id,
          status,
          recommended_amount,
          qualification_min,
          qualification_max,
          passes_liquidity_check,
          created_at,
          estimated_rate,
          requested_loan_amount,
          verified_liquidity,
          required_liquidity,
          borrower_type,
          loan_type,
          estimated_purchase_price,
          property_state,
          conditions,
          expires_at
        `)
        .eq('intake_submission_id', applicationId)
        .maybeSingle();

      const loanReq = submission.loan_requests?.[0];
      const prop = submission.properties?.[0];

      const mapped: LoanApplicationFull = {
        id: submission.id,
        status: submission.status,
        processing_stage: submission.processing_stage || 'pending',
        created_at: submission.created_at,
        updated_at: submission.updated_at,
        loan_request: loanReq ? {
          requested_amount: loanReq.requested_amount,
          loan_type: loanReq.loan_purpose,
          loan_purpose: loanReq.loan_purpose,
          term_months: loanReq.term_months,
          interest_type: loanReq.interest_type,
          exit_strategy: loanReq.exit_strategy,
          amortization_type: loanReq.amortization_type,
          requested_rate: loanReq.requested_rate,
          use_of_proceeds: loanReq.use_of_proceeds,
        } : null,
        property: prop ? {
          id: prop.id,
          property_address: prop.address_street,
          property_type: prop.property_type,
          estimated_value: prop.purchase_price || 0,
          property_city: prop.address_city || '',
          property_state: prop.address_state || '',
          property_zip: prop.address_zip || '',
          square_footage: prop.total_sqft || 0,
          year_built: prop.year_built || 0,
          number_of_units: prop.total_units || 0,
        } : null,
        pre_approval: preApprovalData ? {
          id: preApprovalData.id,
          status: preApprovalData.status,
          recommended_amount: preApprovalData.recommended_amount || 0,
          qualification_min: preApprovalData.qualification_min || 0,
          qualification_max: preApprovalData.qualification_max || 0,
          passes_liquidity_check: preApprovalData.passes_liquidity_check ?? true,
          created_at: preApprovalData.created_at,
          estimated_rate_min: preApprovalData.estimated_rate || 0,
          estimated_rate_max: preApprovalData.estimated_rate || 0,
          requested_loan_amount: preApprovalData.requested_loan_amount || 0,
          verified_liquidity: preApprovalData.verified_liquidity || 0,
          required_liquidity: preApprovalData.required_liquidity || 0,
          borrower_type: preApprovalData.borrower_type || 'individual',
          loan_type: preApprovalData.loan_type || 'dscr',
          estimated_purchase_price: preApprovalData.estimated_purchase_price || 0,
          property_state: preApprovalData.property_state || '',
          conditions: Array.isArray(preApprovalData.conditions) ? preApprovalData.conditions : [],
          expires_at: preApprovalData.expires_at || '',
          letter_number: `PA-${preApprovalData.id.slice(0, 8).toUpperCase()}`,
        } : null,
        documents: submission.uploaded_documents || [],
        borrower: borrowerData,
      };

      setApplication(mapped);

      const { data: bankData } = await supabase
        .from('bank_statement_accounts')
        .select(`
          id, bank_name, account_type, account_holder_name,
          statement_period_start, statement_period_end,
          opening_balance, closing_balance, available_cash,
          total_deposits, total_withdrawals,
          deposit_count, withdrawal_count,
          extraction_confidence, created_at
        `)
        .eq('intake_submission_id', applicationId)
        .order('statement_period_start', { ascending: false });

      setBankAccounts(bankData || []);
    } catch (err) {
      console.error('Error fetching application detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  };

  const getDocStatusConfig = (status: string) => {
    return DOC_STATUS_CONFIG[status] || DOC_STATUS_CONFIG.pending;
  };

  const getLoanTypeLabel = (type: string | undefined) => {
    if (!type) return 'Loan Application';
    return LOAN_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const canDeleteApplication = (status: string): boolean => {
    return ['draft', 'pending'].includes(status.toLowerCase());
  };

  const handleDeleteApplication = async () => {
    if (!user || !application) return;

    setIsDeleting(true);
    try {
      if (source === 'application') {
        const { error } = await supabase
          .from('loan_applications')
          .delete()
          .eq('id', applicationId)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('intake_submissions')
          .delete()
          .eq('id', applicationId)
          .eq('user_id', user.id);

        if (error) throw error;
      }

      onBack();
    } catch (err) {
      console.error('Error deleting application:', err);
      alert('Failed to delete application. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const getStageIndex = (stage: string): number => {
    const stageMap: Record<string, number> = {
      'pending': 0,
      'submitted': 0,
      'intake_received': 0,
      'documents_uploading': 1,
      'documents_uploaded': 1,
      'documents': 1,
      'documents_processing': 2,
      'documents_processed': 2,
      'documents_failed': 2,
      'processing': 2,
      'review': 3,
      'underwriting': 3,
      'pre_approval': 4,
      'pre_approval_complete': 4,
      'approved': 4,
      'completed': 4,
    };
    return stageMap[stage] ?? 0;
  };

  const handleDownloadPreApprovalLetter = async () => {
    if (!application?.pre_approval) return;

    const preApproval = application.pre_approval;
    const { data: submission } = await supabase
      .from('intake_submissions')
      .select('borrower_id')
      .eq('id', applicationId)
      .maybeSingle();
    const branding = submission?.borrower_id
      ? await fetchOrgBrandingForBorrower(submission.borrower_id)
      : { orgName: 'Key Real Estate Capital', orgLogoUrl: null };
    const issueDate = new Date(preApproval.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const expirationDate = preApproval.expires_at
      ? new Date(preApproval.expires_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

    const htmlContent = generatePreApprovalPdfHtml({
      ...branding,
      borrowerName: application.borrower?.borrower_name || 'Borrower',
      borrowerType: preApproval.borrower_type as 'individual' | 'entity',
      loanAmount: preApproval.requested_loan_amount || preApproval.recommended_amount,
      qualificationMin: preApproval.qualification_min,
      qualificationMax: preApproval.qualification_max,
      loanType: preApproval.loan_type || application.loan_request?.loan_type || 'dscr',
      propertyAddress: application.property?.property_address || '',
      propertyCity: application.property?.property_city || '',
      propertyState: application.property?.property_state || preApproval.property_state || '',
      propertyZip: application.property?.property_zip || '',
      purchasePrice: preApproval.estimated_purchase_price || application.property?.estimated_value || 0,
      verifiedLiquidity: preApproval.verified_liquidity,
      requiredLiquidity: preApproval.required_liquidity,
      passesLiquidityCheck: preApproval.passes_liquidity_check,
      conditions: preApproval.conditions,
      placerBotConditions: [],
      matchedPrograms: [],
      issueDate,
      expirationDate,
      letterNumber: preApproval.letter_number,
      creditScore: application.borrower?.credit_score,
    });

    downloadPdf(htmlContent, `pre-approval-letter-${preApproval.letter_number}.pdf`);
  };

  const handleDownloadDocument = async (doc: typeof application.documents[0]) => {
    if (!doc.file_path) {
      alert('Document file not available');
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .download(doc.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document. Please try again.');
    }
  };

  const handleViewDocument = async (doc: typeof application.documents[0]) => {
    if (!doc.file_path) {
      alert('Document file not available');
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(doc.file_path, 3600);

      if (error) throw error;

      window.open(data.signedUrl, '_blank');
    } catch (err) {
      console.error('Error viewing document:', err);
      alert('Failed to view document. Please try again.');
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user || !application) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const { data: submission } = await supabase
        .from('intake_submissions')
        .select('borrower_id')
        .eq('id', applicationId)
        .maybeSingle();

      if (!submission?.borrower_id) {
        setUploadError('Unable to upload: borrower profile not found for this application.');
        return;
      }

      console.log('[DetailUpload] Starting upload', {
        borrowerId: submission.borrower_id,
        applicationId,
        userId: user.id,
      });

      for (const file of Array.from(files)) {
        const fileId = crypto.randomUUID();
        const filePath = `${user.id}/${applicationId}/${fileId}-${file.name}`;

        const { error: storageError } = await supabase.storage
          .from('borrower-documents')
          .upload(filePath, file);

        if (storageError) {
          console.error('[DetailUpload] Storage error:', storageError);
          setUploadError(`Failed to upload ${file.name}. Please try again.`);
          continue;
        }

        const { error: dbError } = await supabase.from('uploaded_documents').insert({
          intake_submission_id: applicationId,
          borrower_id: submission.borrower_id,
          file_path: filePath,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type,
          document_type: 'bank_statement',
          processing_status: 'pending',
        });

        if (dbError) {
          console.error('[DetailUpload] DB insert error:', dbError);
          setUploadError(`Failed to register ${file.name}. Please try again.`);
          continue;
        }

        console.log('[DetailUpload] Document registered:', { fileId, filePath });
      }

      fetchApplicationDetail();
    } catch (err) {
      console.error('[DetailUpload] Error:', err);
      setUploadError('An error occurred during upload. Please try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleProcessDocuments = async () => {
    if (!application || isProcessing) return;

    const pendingDocs = application.documents.filter(
      d => d.processing_status === 'pending' || d.processing_status === 'queued'
    );
    if (pendingDocs.length === 0) {
      setProcessError('No pending documents to process.');
      return;
    }

    setIsProcessing(true);
    setProcessError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/process-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ submission_id: applicationId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Processing failed');
      }

      await fetchApplicationDetail();
    } catch (err) {
      console.error('[ProcessDocs] Error:', err);
      setProcessError(err instanceof Error ? err.message : 'Failed to process documents');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          Loading application details...
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Application Not Found</h3>
        <p className="text-gray-500 mb-4">
          This application may have been deleted or you don't have access to it.
        </p>
        <button
          onClick={onBack}
          className="text-teal-600 hover:text-teal-700 font-medium"
        >
          Go back to applications
        </button>
      </div>
    );
  }

  const isIncomplete = !application.loan_request || !application.property;
  const displayStatus = isIncomplete && !application.pre_approval ? 'incomplete' : application.status;
  const statusConfig = getStatusConfig(displayStatus);
  const StatusIcon = statusConfig.icon;
  const currentStageIndex = getStageIndex(application.processing_stage);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {getLoanTypeLabel(application.loan_request?.loan_type)}
          </h1>
          <p className="text-sm text-gray-500">
            Application ID: {application.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-4 py-2 rounded-full text-sm font-medium ${statusConfig.bg} ${statusConfig.text} flex items-center gap-2`}>
            <StatusIcon className="w-4 h-4" />
            {statusConfig.label}
          </span>
          {canDeleteApplication(application.status) && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete application"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Application</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this application? This action cannot be undone and all associated data will be permanently removed.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteApplication}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Application'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isIncomplete && !application.pre_approval && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-amber-800">Incomplete Application</h3>
              <p className="text-amber-700 text-sm mt-1">
                {!application.loan_request && !application.property
                  ? 'Loan and property details are missing.'
                  : !application.loan_request
                  ? 'Loan details are missing.'
                  : 'Property details are missing.'}
                {' '}Please complete all required information to proceed with your application.
              </p>
            </div>
          </div>
        </div>
      )}

      {application.pre_approval && (
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-6 text-white">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-6 h-6" />
            <h3 className="text-lg font-semibold">Pre-Approval Status</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-emerald-100 text-sm">Qualification Range</p>
              <p className="text-xl font-bold">
                {formatCurrency(application.pre_approval.qualification_min)} - {formatCurrency(application.pre_approval.qualification_max)}
              </p>
            </div>
            <div>
              <p className="text-emerald-100 text-sm">Recommended Amount</p>
              <p className="text-xl font-bold">
                {formatCurrency(application.pre_approval.recommended_amount)}
              </p>
            </div>
            {application.pre_approval.estimated_rate_min > 0 && (
              <div>
                <p className="text-emerald-100 text-sm">Est. Rate Range</p>
                <p className="text-xl font-bold">
                  {application.pre_approval.estimated_rate_min}% - {application.pre_approval.estimated_rate_max}%
                </p>
              </div>
            )}
            <div>
              <p className="text-emerald-100 text-sm">Liquidity Check</p>
              <p className="text-xl font-bold">
                {application.pre_approval.passes_liquidity_check ? 'Passed' : 'Review Required'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {(['overview', 'financials', 'documents', 'timeline'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors capitalize flex items-center gap-1.5 ${
              activeTab === tab
                ? 'border-teal-600 text-teal-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'financials' ? 'Extracted Data' : tab}
            {tab === 'financials' && bankAccounts.length > 0 && (
              <span className="bg-teal-100 text-teal-700 text-xs px-1.5 py-0.5 rounded-full font-medium">
                {bankAccounts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-600" />
                Loan Details
              </h3>
            </div>
            <div className="p-6">
              {application.loan_request ? (
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Requested Amount</dt>
                    <dd className="font-medium text-gray-900">
                      {formatCurrency(application.loan_request.requested_amount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Loan Type</dt>
                    <dd className="font-medium text-gray-900">
                      {getLoanTypeLabel(application.loan_request.loan_type)}
                    </dd>
                  </div>
                  {application.loan_request.loan_purpose && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Purpose</dt>
                      <dd className="font-medium text-gray-900 capitalize">
                        {application.loan_request.loan_purpose.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}
                  {application.loan_request.term_months && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Term</dt>
                      <dd className="font-medium text-gray-900">
                        {application.loan_request.term_months} months
                      </dd>
                    </div>
                  )}
                  {application.loan_request.interest_type && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Interest Type</dt>
                      <dd className="font-medium text-gray-900 capitalize">
                        {application.loan_request.interest_type.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}
                  {application.loan_request.exit_strategy && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Exit Strategy</dt>
                      <dd className="font-medium text-gray-900 capitalize">
                        {application.loan_request.exit_strategy.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-center py-4">
                  <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-medium">Loan details not yet provided</p>
                  <p className="text-gray-500 text-sm mt-1">This application is incomplete</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Home className="w-5 h-5 text-teal-600" />
                Property Details
              </h3>
            </div>
            <div className="p-6">
              {application.property ? (
                <dl className="space-y-4">
                  <div>
                    <dt className="text-gray-500 text-sm">Address</dt>
                    <dd className="font-medium text-gray-900 mt-1">
                      {application.property.property_address}
                    </dd>
                    <dd className="text-gray-600">
                      {application.property.property_city}, {application.property.property_state} {application.property.property_zip}
                    </dd>
                  </div>
                  {application.property.property_type && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Property Type</dt>
                      <dd className="font-medium text-gray-900 capitalize">
                        {application.property.property_type.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}
                  {application.property.estimated_value > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Estimated Value</dt>
                      <dd className="font-medium text-gray-900">
                        {formatCurrency(application.property.estimated_value)}
                      </dd>
                    </div>
                  )}
                  {application.property.square_footage > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Square Footage</dt>
                      <dd className="font-medium text-gray-900">
                        {application.property.square_footage.toLocaleString()} sq ft
                      </dd>
                    </div>
                  )}
                  {application.property.year_built > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Year Built</dt>
                      <dd className="font-medium text-gray-900">
                        {application.property.year_built}
                      </dd>
                    </div>
                  )}
                  {application.property.number_of_units > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Units</dt>
                      <dd className="font-medium text-gray-900">
                        {application.property.number_of_units}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-center py-4">
                  <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-medium">Property details not yet provided</p>
                  <p className="text-gray-500 text-sm mt-1">This application is incomplete</p>
                </div>
              )}
            </div>
          </div>

          {application.borrower && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <User className="w-5 h-5 text-teal-600" />
                  Borrower Information
                </h3>
              </div>
              <div className="p-6">
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Name</dt>
                    <dd className="font-medium text-gray-900">
                      {application.borrower.borrower_name}
                    </dd>
                  </div>
                  {application.borrower.email && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Email</dt>
                      <dd className="font-medium text-gray-900">
                        {application.borrower.email}
                      </dd>
                    </div>
                  )}
                  {application.borrower.phone && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Phone</dt>
                      <dd className="font-medium text-gray-900">
                        {application.borrower.phone}
                      </dd>
                    </div>
                  )}
                  {application.borrower.credit_score > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Credit Score</dt>
                      <dd className="font-medium text-gray-900">
                        {application.borrower.credit_score}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-teal-600" />
                Application Timeline
              </h3>
            </div>
            <div className="p-6">
              <dl className="space-y-4">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Submitted</dt>
                  <dd className="font-medium text-gray-900">
                    {formatDateTime(application.created_at)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Last Updated</dt>
                  <dd className="font-medium text-gray-900">
                    {formatDateTime(application.updated_at)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Current Stage</dt>
                  <dd className="font-medium text-gray-900 capitalize">
                    {isIncomplete && !application.pre_approval
                      ? 'Awaiting required information'
                      : STAGE_LABELS[application.processing_stage] ?? application.processing_stage?.replace(/_/g, ' ') ?? 'Pending'}
                  </dd>
                </div>
                {application.pre_approval && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Pre-Approved On</dt>
                    <dd className="font-medium text-gray-900">
                      {formatDateTime(application.pre_approval.created_at)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'financials' && (
        <div className="space-y-6">
          {bankAccounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Landmark className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Documents Must Be Processed</h3>
              <p className="text-gray-500 text-sm max-w-sm mx-auto">
                Financial data will appear here after you upload bank statements and click "Process Documents" to analyze them.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500 mb-1">Total Available Cash</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(bankAccounts.reduce((sum, a) => sum + (a.available_cash || a.closing_balance || 0), 0))}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Across {bankAccounts.length} statement{bankAccounts.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500 mb-1">Total Monthly Deposits</p>
                  <p className="text-2xl font-bold text-green-700">
                    {formatCurrency(bankAccounts.reduce((sum, a) => sum + (a.total_deposits || 0), 0))}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Combined across all statements</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500 mb-1">Total Withdrawals</p>
                  <p className="text-2xl font-bold text-red-700">
                    {formatCurrency(bankAccounts.reduce((sum, a) => sum + (a.total_withdrawals || 0), 0))}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Combined across all statements</p>
                </div>
              </div>

              {bankAccounts.map((account) => (
                <div key={account.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Landmark className="w-5 h-5 text-teal-600" />
                      <div>
                        <h3 className="font-semibold text-gray-900">{account.bank_name}</h3>
                        <p className="text-sm text-gray-500 capitalize">{account.account_type} account — {account.account_holder_name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {account.statement_period_start && (
                        <p className="text-sm text-gray-500">
                          {new Date(account.statement_period_start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          {account.statement_period_end && ` — ${new Date(account.statement_period_end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                        </p>
                      )}
                      {account.extraction_confidence > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {Math.round(account.extraction_confidence * 100)}% confidence
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Opening Balance</p>
                        <p className="text-lg font-semibold text-gray-900">{formatCurrency(account.opening_balance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Closing Balance</p>
                        <p className="text-lg font-semibold text-gray-900">{formatCurrency(account.closing_balance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Available Cash</p>
                        <p className="text-lg font-semibold text-teal-700">{formatCurrency(account.available_cash || account.closing_balance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Flow</p>
                        <p className={`text-lg font-semibold ${(account.total_deposits - account.total_withdrawals) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatCurrency(account.total_deposits - account.total_withdrawals)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3">
                        <ArrowDownCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Deposits</p>
                          <p className="text-sm font-medium text-gray-900">
                            {formatCurrency(account.total_deposits)}
                            {account.deposit_count > 0 && <span className="text-gray-400 font-normal ml-1">({account.deposit_count} transactions)</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <ArrowUpCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Withdrawals</p>
                          <p className="text-sm font-medium text-gray-900">
                            {formatCurrency(account.total_withdrawals)}
                            {account.withdrawal_count > 0 && <span className="text-gray-400 font-normal ml-1">({account.withdrawal_count} transactions)</span>}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-600" />
              Uploaded Documents
            </h3>
            <span className="text-sm text-gray-500">
              {application.documents.length} document{application.documents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {(uploadError || processError) && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{uploadError || processError}</p>
              </div>
            </div>
          )}

          {source === 'intake' && (
            <div className="px-6 pt-4 space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-teal-400 transition-colors">
                <input
                  type="file"
                  id="detail-doc-upload"
                  multiple
                  accept=".pdf"
                  onChange={handleDocumentUpload}
                  className="hidden"
                  disabled={isUploading}
                />
                <label htmlFor="detail-doc-upload" className={`cursor-pointer ${isUploading ? 'pointer-events-none' : ''}`}>
                  {isUploading ? (
                    <>
                      <Loader2 className="w-8 h-8 text-teal-600 mx-auto mb-2 animate-spin" />
                      <p className="text-sm font-medium text-gray-600">Uploading...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-900">Click to upload documents</p>
                      <p className="text-xs text-gray-500 mt-1">PDF files accepted</p>
                    </>
                  )}
                </label>
              </div>

              {application.documents.filter(d => d.processing_status === 'pending' || d.processing_status === 'queued').length > 0 && (
                <button
                  onClick={handleProcessDocuments}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing Documents...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" />
                      Process {application.documents.filter(d => d.processing_status === 'pending' || d.processing_status === 'queued').length} Document{application.documents.filter(d => d.processing_status === 'pending' || d.processing_status === 'queued').length !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {application.documents.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h4 className="font-medium text-gray-900 mb-2">No Documents Yet</h4>
              <p className="text-gray-500">
                Upload documents above to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {application.documents.map((doc) => {
                const docStatus = getDocStatusConfig(doc.processing_status);
                const isBankStatement = doc.document_type === 'bank_statement';
                return (
                  <div key={doc.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          isBankStatement ? 'bg-teal-100' : 'bg-gray-100'
                        }`}>
                          <FileText className={`w-5 h-5 ${
                            isBankStatement ? 'text-teal-600' : 'text-gray-500'
                          }`} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{doc.file_name}</p>
                          <div className="flex items-center gap-3 text-sm text-gray-500">
                            <span className="capitalize">
                              {doc.document_type?.replace(/_/g, ' ') || 'Document'}
                            </span>
                            {doc.file_size_bytes > 0 && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span>{formatFileSize(doc.file_size_bytes)}</span>
                              </>
                            )}
                            <span className="text-gray-300">|</span>
                            <span>{formatDate(doc.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${docStatus.bg} ${docStatus.text}`}>
                          {docStatus.label}
                        </span>
                        {doc.file_path && (
                          <>
                            <button
                              onClick={() => handleViewDocument(doc)}
                              className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                              title="View document"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDownloadDocument(doc)}
                              className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                              title="Download document"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-6">Application Progress</h3>

          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

            <div className="space-y-6">
              {STAGE_TIMELINE.map((stage, index) => {
                const isCompleted = index < currentStageIndex;
                const isCurrent = index === currentStageIndex;
                const Icon = stage.icon;

                return (
                  <div key={stage.id} className="relative flex items-start gap-4 pl-10">
                    <div
                      className={`absolute left-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        isCompleted
                          ? 'bg-teal-500 text-white'
                          : isCurrent
                          ? 'bg-teal-500 text-white ring-4 ring-teal-100'
                          : 'bg-gray-200 text-gray-400'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 pb-6">
                      <p className={`font-medium ${isCompleted || isCurrent ? 'text-gray-900' : 'text-gray-400'}`}>
                        {stage.label}
                      </p>
                      {isCompleted && (
                        <p className="text-sm text-green-600 mt-1">Completed</p>
                      )}
                      {isCurrent && (
                        <p className="text-sm text-teal-600 mt-1">In Progress</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
