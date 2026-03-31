import { useState, useMemo } from 'react';
import { ClipboardList, Search, Building2, User, DollarSign, MapPin, Clock, FileText, CheckCircle as CheckCircle2, Circle as XCircle, ChevronRight, Loader as Loader2, RefreshCw, Bot } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { useAnalystDashboard } from '../../modules/analyst-review/hooks/useAnalystDashboard';
import { formatCurrency, formatTimeAgo } from '../../shared/utils';
import type { Application } from '../../shared/types';

interface AnalystDashboardProps {
  onSelectSubmission: (submissionId: string) => void;
  onNavigatePlacerBot?: () => void;
}

type StatusFilter = 'all' | 'pending_review' | 'preapproved' | 'declined' | 'submitted';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'preapproved', label: 'Pre-Approved' },
  { value: 'declined', label: 'Declined' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: FileText },
  in_progress: { label: 'In Progress', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: RefreshCw },
  submitted: { label: 'Submitted', color: 'text-cyan-600', bgColor: 'bg-cyan-100', icon: Clock },
  pending_review: { label: 'Pending Review', color: 'text-amber-600', bgColor: 'bg-amber-100', icon: Clock },
  needs_revision: { label: 'Needs Revision', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: XCircle },
  preapproved: { label: 'Pre-Approved', color: 'text-teal-600', bgColor: 'bg-teal-100', icon: CheckCircle2 },
  declined: { label: 'Declined', color: 'text-red-600', bgColor: 'bg-red-100', icon: XCircle },
  placed: { label: 'Placed', color: 'text-emerald-600', bgColor: 'bg-emerald-100', icon: CheckCircle2 },
  funded: { label: 'Funded', color: 'text-green-600', bgColor: 'bg-green-100', icon: CheckCircle2 },
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase', refinance: 'Refinance', dscr: 'DSCR', bridge: 'Bridge',
  fix_flip: 'Fix & Flip', construction: 'Construction', commercial: 'Commercial',
};

export function AnalystDashboard({ onSelectSubmission, onNavigatePlacerBot }: AnalystDashboardProps) {
  const { user } = useAuth();
  const { applications, statusCounts, isLoading, refetch } = useAnalystDashboard();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending_review');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount_high' | 'amount_low'>('newest');

  const filteredApplications = useMemo(() => {
    return applications
      .filter((app: Application) => {
        if (statusFilter !== 'all' && app.status !== statusFilter) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const borrower = app.borrowers;
        return (
          borrower?.borrower_name?.toLowerCase().includes(q) ||
          borrower?.email?.toLowerCase().includes(q) ||
          app.properties?.[0]?.address_city?.toLowerCase().includes(q) ||
          app.id.toLowerCase().includes(q)
        );
      })
      .sort((a: Application, b: Application) => {
        switch (sortBy) {
          case 'oldest':
            return new Date(a.submitted_at || a.created_at).getTime() - new Date(b.submitted_at || b.created_at).getTime();
          case 'amount_high':
            return (b.loan_requests?.[0]?.requested_amount || 0) - (a.loan_requests?.[0]?.requested_amount || 0);
          case 'amount_low':
            return (a.loan_requests?.[0]?.requested_amount || 0) - (b.loan_requests?.[0]?.requested_amount || 0);
          default:
            return new Date(b.submitted_at || b.created_at).getTime() - new Date(a.submitted_at || a.created_at).getTime();
        }
      });
  }, [applications, statusFilter, searchQuery, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Application Review Queue</h1>
          <p className="text-gray-500 mt-1">Review and manage loan applications</p>
        </div>
        <div className="flex items-center gap-3">
          {user && <NotificationCenter userId={user.id} />}
          {onNavigatePlacerBot && (
            <button
              onClick={onNavigatePlacerBot}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Bot className="w-4 h-4" />
              PlacerBot
            </button>
          )}
          <button
            onClick={refetch}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {['pending_review', 'submitted', 'preapproved', 'declined'].map((key) => {
          const count = statusCounts[key] || 0;
          const cfg = STATUS_CONFIG[key];
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key as StatusFilter)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                statusFilter === key
                  ? `border-teal-400 bg-teal-50`
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`text-2xl font-bold ${statusFilter === key ? 'text-teal-700' : 'text-gray-900'}`}>
                {count}
              </div>
              <div className={`text-sm ${statusFilter === key ? 'text-teal-600' : 'text-gray-500'}`}>
                {cfg?.label || key}
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email, city, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="amount_high">Amount: High to Low</option>
                <option value="amount_low">Amount: Low to High</option>
              </select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <ClipboardList className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No applications found</p>
            <p className="text-sm">Try adjusting your filters or search query</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredApplications.map((app: Application) => {
              const statusCfg = STATUS_CONFIG[app.status] || STATUS_CONFIG.draft;
              const StatusIcon = statusCfg.icon;
              const loanRequest = app.loan_requests?.[0];
              const property = app.properties?.[0];
              const borrower = app.borrowers;
              const docCount = app.uploaded_documents?.length || 0;

              return (
                <button
                  key={app.id}
                  onClick={() => onSelectSubmission(app.id)}
                  className="w-full p-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {borrower?.entity_type === 'llc' || borrower?.entity_type === 'corporation' ? (
                          <Building2 className="w-5 h-5 text-gray-600" />
                        ) : (
                          <User className="w-5 h-5 text-gray-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-semibold text-gray-900 truncate">
                            {borrower?.borrower_name || borrower?.email?.split('@')[0] || 'Unknown'}
                          </h3>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.bgColor} ${statusCfg.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusCfg.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                          {loanRequest?.requested_amount ? (
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-4 h-4" />
                              {formatCurrency(loanRequest.requested_amount)}
                            </span>
                          ) : null}
                          {loanRequest?.loan_purpose && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                              {LOAN_TYPE_LABELS[loanRequest.loan_purpose] || loanRequest.loan_purpose}
                            </span>
                          )}
                          {property && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              {property.address_city}, {property.address_state}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimeAgo(app.submitted_at || app.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {docCount} doc{docCount !== 1 ? 's' : ''}
                          </span>
                          <span className="text-gray-300">#{app.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 mt-2" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
