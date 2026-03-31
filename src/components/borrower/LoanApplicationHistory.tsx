import { useState, useEffect } from 'react';
import {
  FileText, Calendar, Home, DollarSign, Clock, CheckCircle,
  XCircle, AlertCircle, ChevronRight, Search, Filter, Download,
  Building, TrendingUp, Eye, ArrowUpDown, X, Trash2, CheckSquare, Square, Loader2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { generatePreApprovalPdfHtml, downloadPdf } from '../../lib/pdfGenerator';

interface LoanApplication {
  id: string;
  source: 'intake' | 'application';
  status: string;
  current_stage: string;
  created_at: string;
  updated_at: string;
  loan_type: string | null;
  loan_purpose: string | null;
  requested_amount: number | null;
  property_address: string | null;
  property_type: string | null;
  property_city: string | null;
  property_state: string | null;
  pre_approval_status: string | null;
  pre_approval_amount: number | null;
  documents_count: number;
}

interface Props {
  onBack: () => void;
  onSelectApplication: (applicationId: string) => void;
  onContinueDraft?: (applicationId: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: typeof CheckCircle }> = {
  draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-600', icon: FileText },
  pending: { label: 'Pending', bg: 'bg-gray-100', text: 'text-gray-600', icon: FileText },
  submitted: { label: 'Submitted', bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock },
  pending_review: { label: 'Under Review', bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
  processing: { label: 'Processing', bg: 'bg-blue-100', text: 'text-blue-700', icon: Clock },
  preapproved: { label: 'Pre-Approved', bg: 'bg-teal-100', text: 'text-teal-700', icon: CheckCircle },
  approved: { label: 'Approved', bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
  declined: { label: 'Declined', bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  dscr: 'DSCR Loan',
  bank_statement: 'Bank Statement',
  fix_flip: 'Fix & Flip',
  bridge: 'Bridge Loan',
  construction: 'Construction',
  commercial: 'Commercial',
  rental: 'Rental Property',
  mixed_use: 'Mixed Use',
  multifamily: 'Multifamily',
  purchase: 'Purchase',
};

export function LoanApplicationHistory({ onBack, onSelectApplication, onContinueDraft }: Props) {
  const { user, userAccount } = useAuth();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'created_at' | 'updated_at' | 'amount'>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; source: 'intake' | 'application' } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchApplications();
    }
  }, [user]);

  const fetchApplications = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const [intakeResult, appResult] = await Promise.all([
        supabase
          .from('intake_submissions')
          .select(`
            id,
            status,
            processing_stage,
            created_at,
            updated_at,
            loan_requests (
              requested_amount,
              loan_purpose
            ),
            properties (
              address_street,
              property_type,
              address_city,
              address_state
            ),
            uploaded_documents (id)
          `)
          .eq('user_id', user.id)
          .in('status', ['draft', 'pending', 'submitted', 'pending_review', 'processing', 'approved', 'preapproved', 'declined', 'placed', 'funded'])
          .order('created_at', { ascending: false }),
        supabase
          .from('loan_applications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
      ]);

      if (intakeResult.error) {
        console.error('Intake fetch error:', intakeResult.error);
      }
      if (appResult.error) {
        console.error('App fetch error:', appResult.error);
      }

      const intakeApps: LoanApplication[] = (intakeResult.data || []).map(s => {
        const hasLoanInfo = s.loan_requests?.[0]?.requested_amount || s.loan_requests?.[0]?.loan_purpose;
        const hasPropertyInfo = s.properties?.[0]?.address_street || s.properties?.[0]?.address_state;
        const isIncomplete = !hasLoanInfo && !hasPropertyInfo && s.status === 'draft';
        const displayStatus = isIncomplete ? 'draft' : s.status;

        return {
          id: s.id,
          source: 'intake' as const,
          status: displayStatus,
          current_stage: s.processing_stage || 'pending',
          created_at: s.created_at,
          updated_at: s.updated_at,
          loan_type: s.loan_requests?.[0]?.loan_purpose || null,
          loan_purpose: s.loan_requests?.[0]?.loan_purpose || null,
          requested_amount: s.loan_requests?.[0]?.requested_amount || null,
          property_address: s.properties?.[0]?.address_street || null,
          property_type: s.properties?.[0]?.property_type || null,
          property_city: s.properties?.[0]?.address_city || null,
          property_state: s.properties?.[0]?.address_state || null,
          pre_approval_status: s.processing_stage === 'pre_approval_complete' ? 'approved' : null,
          pre_approval_amount: null,
          documents_count: s.uploaded_documents?.length || 0,
        };
      });

      const loanApps: LoanApplication[] = (appResult.data || []).map(a => ({
        id: a.id,
        source: 'application' as const,
        status: a.current_stage || 'pending',
        current_stage: a.current_stage || 'pending',
        created_at: a.created_at,
        updated_at: a.updated_at,
        loan_type: a.loan_type,
        loan_purpose: a.loan_purpose,
        requested_amount: a.requested_amount,
        property_address: null,
        property_type: a.property_type,
        property_city: null,
        property_state: a.property_state,
        pre_approval_status: a.pre_approval_status,
        pre_approval_amount: a.pre_approval_amount,
        documents_count: 0,
      }));

      const all = [...intakeApps, ...loanApps].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setApplications(all);
    } catch (err) {
      console.error('Error fetching applications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const canDeleteApplication = (status: string): boolean => {
    return ['draft', 'pending'].includes(status.toLowerCase());
  };

  const getAppKey = (app: LoanApplication) => `${app.source}-${app.id}`;

  const toggleSelection = (app: LoanApplication) => {
    const key = getAppKey(app);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === deletableApplications.length && deletableApplications.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deletableApplications.map(getAppKey)));
    }
  };

  const getSelectedApplications = () => {
    return filteredApplications.filter(app => selectedIds.has(getAppKey(app)));
  };

  const handleBulkDelete = async () => {
    if (!user || selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      const appsToDelete = getSelectedApplications();
      const intakeIds = appsToDelete.filter(a => a.source === 'intake').map(a => a.id);
      const applicationIds = appsToDelete.filter(a => a.source === 'application').map(a => a.id);

      const deletePromises: Promise<unknown>[] = [];

      if (intakeIds.length > 0) {
        deletePromises.push(
          supabase
            .from('intake_submissions')
            .delete()
            .in('id', intakeIds)
            .eq('user_id', user.id)
        );
      }

      if (applicationIds.length > 0) {
        deletePromises.push(
          supabase
            .from('loan_applications')
            .delete()
            .in('id', applicationIds)
            .eq('user_id', user.id)
        );
      }

      await Promise.all(deletePromises);

      setApplications(prev => prev.filter(app => !selectedIds.has(getAppKey(app))));
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Error deleting applications:', err);
      alert('Failed to delete some applications. Please try again.');
    } finally {
      setIsDeleting(false);
      setBulkDeleteConfirm(false);
    }
  };

  const handleDeleteApplication = async () => {
    if (!user || !deleteConfirm) return;

    setIsDeleting(true);
    try {
      const tableName = deleteConfirm.source === 'application' ? 'loan_applications' : 'intake_submissions';
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', deleteConfirm.id)
        .eq('user_id', user.id);

      if (error) throw error;

      setApplications(prev => prev.filter(app =>
        !(app.id === deleteConfirm.id && app.source === deleteConfirm.source)
      ));
    } catch (err) {
      console.error('Error deleting application:', err);
      alert('Failed to delete application. Please try again.');
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  };

  const handleDownloadPreApproval = async (app: LoanApplication) => {
    if (!user) return;

    setDownloadingId(app.id);
    try {
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
        .eq('intake_submission_id', app.id)
        .maybeSingle();

      if (!preApprovalData) {
        alert('Pre-approval letter is not available yet. Please complete the pre-approval process first.');
        return;
      }

      const issueDate = new Date(preApprovalData.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const expirationDate = preApprovalData.expires_at
        ? new Date(preApprovalData.expires_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });

      const letterData = {
        id: preApprovalData.id,
        loanAmount: preApprovalData.requested_loan_amount || preApprovalData.recommended_amount || 0,
        qualificationMin: preApprovalData.qualification_min || 0,
        qualificationMax: preApprovalData.qualification_max || 0,
        loanType: preApprovalData.loan_type || app.loan_type || 'dscr',
        borrowerType: (preApprovalData.borrower_type as 'individual' | 'entity') || 'individual',
        propertyState: preApprovalData.property_state || app.property_state || '',
        purchasePrice: preApprovalData.estimated_purchase_price || app.requested_amount || 0,
        verifiedLiquidity: preApprovalData.verified_liquidity || 0,
        requiredLiquidity: preApprovalData.required_liquidity || 0,
        passesLiquidityCheck: preApprovalData.passes_liquidity_check ?? true,
        conditions: Array.isArray(preApprovalData.conditions) ? preApprovalData.conditions : [],
        issueDate,
        expirationDate,
      };

      const letterNumber = `PA-${letterData.id.slice(0, 8).toUpperCase()}`;

      const htmlContent = generatePreApprovalPdfHtml({
        borrowerName: userAccount?.full_name || user.email?.split('@')[0] || 'Borrower',
        borrowerType: letterData.borrowerType,
        loanAmount: letterData.loanAmount,
        qualificationMin: letterData.qualificationMin,
        qualificationMax: letterData.qualificationMax,
        loanType: letterData.loanType,
        propertyAddress: app.property_address || '',
        propertyCity: app.property_city || '',
        propertyState: letterData.propertyState,
        propertyZip: '',
        purchasePrice: letterData.purchasePrice,
        verifiedLiquidity: letterData.verifiedLiquidity,
        requiredLiquidity: letterData.requiredLiquidity,
        passesLiquidityCheck: letterData.passesLiquidityCheck,
        conditions: letterData.conditions,
        placerBotConditions: [],
        matchedPrograms: [],
        issueDate: letterData.issueDate,
        expirationDate: letterData.expirationDate,
        letterNumber,
      });

      downloadPdf(htmlContent, `pre-approval-letter-${letterNumber}.pdf`);
    } catch (err) {
      console.error('Error downloading pre-approval:', err);
      alert('Failed to download pre-approval letter. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const getLoanTypeLabel = (type: string | null | undefined) => {
    if (!type) return 'Loan Application';
    return LOAN_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const filteredApplications = applications
    .filter(app => {
      if (statusFilter !== 'all' && app.status !== statusFilter) return false;
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const address = app.property_address?.toLowerCase() || '';
        const loanType = app.loan_type?.toLowerCase() || '';
        const id = app.id.toLowerCase();
        return address.includes(search) || loanType.includes(search) || id.includes(search);
      }
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'created_at') {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortField === 'updated_at') {
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      } else if (sortField === 'amount') {
        const amountA = a.requested_amount || 0;
        const amountB = b.requested_amount || 0;
        comparison = amountA - amountB;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  const uniqueStatuses = [...new Set(applications.map(a => a.status))];
  const deletableApplications = filteredApplications.filter(app => canDeleteApplication(app.status));
  const allDeletableSelected = deletableApplications.length > 0 && selectedIds.size === deletableApplications.length;
  const someDeletableSelected = selectedIds.size > 0 && selectedIds.size < deletableApplications.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          Loading your applications...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Loan Applications</h1>
          <p className="text-sm text-gray-500 mt-1">
            {applications.length} application{applications.length !== 1 ? 's' : ''} total
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by address, loan type, or ID..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
              showFilters || statusFilter !== 'all'
                ? 'border-teal-500 bg-teal-50 text-teal-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {statusFilter !== 'all' && (
              <span className="w-2 h-2 bg-teal-500 rounded-full" />
            )}
          </button>

          <button
            onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            <ArrowUpDown className="w-4 h-4" />
            {sortDirection === 'desc' ? 'Newest First' : 'Oldest First'}
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {uniqueStatuses.map(status => {
                const config = getStatusConfig(status);
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      statusFilter === status
                        ? 'bg-teal-600 text-white'
                        : `${config.bg} ${config.text} hover:opacity-80`
                    }`}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {filteredApplications.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          {applications.length === 0 ? (
            <>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Applications Yet</h3>
              <p className="text-gray-500 mb-6">
                Start your first loan application to begin the pre-approval process.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Matching Applications</h3>
              <p className="text-gray-500">
                Try adjusting your search or filters to find what you're looking for.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {deletableApplications.length > 0 && (
            <div className={`bg-white rounded-xl border p-4 flex items-center justify-between transition-all ${
              selectedIds.size > 0 ? 'border-teal-300 bg-teal-50' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-gray-700 hover:text-teal-600 transition-colors"
                >
                  {allDeletableSelected ? (
                    <CheckSquare className="w-5 h-5 text-teal-600" />
                  ) : someDeletableSelected ? (
                    <div className="w-5 h-5 border-2 border-teal-600 rounded bg-teal-600 flex items-center justify-center">
                      <div className="w-2.5 h-0.5 bg-white" />
                    </div>
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">
                    {allDeletableSelected ? 'Deselect All' : 'Select All'}
                  </span>
                </button>
                {selectedIds.size > 0 && (
                  <span className="text-sm text-teal-700 font-medium">
                    {selectedIds.size} selected
                  </span>
                )}
              </div>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected ({selectedIds.size})
                </button>
              )}
            </div>
          )}

          {filteredApplications.map((app) => {
            const statusConfig = getStatusConfig(app.status);
            const StatusIcon = statusConfig.icon;
            const isDeletable = canDeleteApplication(app.status);
            const isSelected = selectedIds.has(getAppKey(app));

            return (
              <div
                key={`${app.source}-${app.id}`}
                className={`bg-white rounded-xl border hover:border-teal-300 hover:shadow-md transition-all overflow-hidden ${
                  isSelected ? 'border-teal-400 ring-2 ring-teal-100' : 'border-gray-200'
                }`}
              >
                <div className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {isDeletable && (
                      <button
                        onClick={() => toggleSelection(app)}
                        className="flex-shrink-0 p-1 rounded hover:bg-gray-100 transition-colors self-start"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-teal-600" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${statusConfig.bg}`}>
                            <StatusIcon className={`w-5 h-5 ${statusConfig.text}`} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {getLoanTypeLabel(app.loan_type)}
                            </h3>
                            <p className="text-sm text-gray-500">
                              ID: {app.id.slice(0, 8)}...
                            </p>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
                          {statusConfig.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                        {(app.property_address || app.property_state) && (
                          <div className="flex items-start gap-2">
                            <Home className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-gray-500">Property</p>
                              {app.property_address ? (
                                <>
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {app.property_address}
                                  </p>
                                  {app.property_city && (
                                    <p className="text-xs text-gray-500">
                                      {app.property_city}, {app.property_state}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="text-sm font-medium text-gray-900">
                                  {app.property_state}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {app.requested_amount && (
                          <div className="flex items-start gap-2">
                            <DollarSign className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500">Requested Amount</p>
                              <p className="text-sm font-medium text-gray-900">
                                {formatCurrency(app.requested_amount)}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start gap-2">
                          <Calendar className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-500">Submitted</p>
                            <p className="text-sm font-medium text-gray-900">
                              {formatDate(app.created_at)}
                            </p>
                            <p className="text-xs text-gray-500">
                              Updated {formatDate(app.updated_at)}
                            </p>
                          </div>
                        </div>

                        {app.documents_count > 0 && (
                          <div className="flex items-start gap-2">
                            <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500">Documents</p>
                              <p className="text-sm font-medium text-gray-900">
                                {app.documents_count} uploaded
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {(app.pre_approval_status || app.pre_approval_amount) && (
                        <div className="mt-4 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              <span className="text-sm font-medium text-emerald-700">
                                Pre-Approved
                              </span>
                            </div>
                            {app.pre_approval_amount && (
                              <div className="text-right">
                                <p className="text-sm font-semibold text-emerald-700">
                                  {formatCurrency(app.pre_approval_amount)}
                                </p>
                                <p className="text-xs text-emerald-600">
                                  Pre-Approved Amount
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex lg:flex-col gap-2 lg:ml-4">
                      {app.status === 'draft' && onContinueDraft ? (
                        <button
                          onClick={() => onContinueDraft(app.id)}
                          className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                          Continue
                        </button>
                      ) : (
                        <button
                          onClick={() => onSelectApplication(app.id)}
                          className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          View Details
                        </button>
                      )}
                                            {canDeleteApplication(app.status) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm({ id: app.id, source: app.source });
                          }}
                          className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-500 rounded-lg font-medium hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-4">
                      {app.property_type && (
                        <span className="flex items-center gap-1">
                          <Building className="w-3.5 h-3.5" />
                          {app.property_type.replace(/_/g, ' ')}
                        </span>
                      )}
                      {app.loan_purpose && (
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {app.loan_purpose.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <span>
                      Stage: {app.current_stage?.replace(/_/g, ' ') || 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filteredApplications.length > 0 && (
        <div className="text-center text-sm text-gray-500">
          Showing {filteredApplications.length} of {applications.length} applications
        </div>
      )}

      {deleteConfirm && (
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
                onClick={() => setDeleteConfirm(null)}
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

      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete {selectedIds.size} Application{selectedIds.size !== 1 ? 's' : ''}</h3>
            </div>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete <span className="font-semibold">{selectedIds.size}</span> application{selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-red-700">
                All associated data including documents, loan requests, and property information will be permanently removed.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete {selectedIds.size} Application{selectedIds.size !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
