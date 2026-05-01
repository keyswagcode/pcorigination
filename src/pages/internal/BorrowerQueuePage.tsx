import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Borrower, LifecycleStage } from '../../shared/types';
import {
  Search,
  Filter,
  ArrowRight,
  Users,
  CheckCircle,
  Shield,
  FileText,
  Upload,
  Briefcase,
  User
} from 'lucide-react';

interface BorrowerQueueItem extends Borrower {
  identity_status?: string;
  document_count?: number;
  owner_name?: string;
  owner_email?: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'documents_processing', label: 'Processing' },
  { value: 'prequalified', label: 'Pre-Approved' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'additional_docs_requested', label: 'Docs Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'conditionally_approved', label: 'Conditionally Approved' },
  { value: 'declined', label: 'Declined' },
];

const LIFECYCLE_STAGES: { value: LifecycleStage | ''; label: string; icon: typeof User }[] = [
  { value: '', label: 'All Stages', icon: Users },
  { value: 'profile_created', label: 'Profile Created', icon: User },
  { value: 'loan_type_selected', label: 'Loan Type Selected', icon: FileText },
  { value: 'documents_uploaded', label: 'Docs Uploaded', icon: Upload },
  { value: 'liquidity_verified', label: 'Liquidity Verified', icon: Shield },
  { value: 'pre_approved', label: 'Pre-Approved', icon: CheckCircle },
  { value: 'application_started', label: 'Application Started', icon: Briefcase },
  { value: 'application_submitted', label: 'App Submitted', icon: CheckCircle },
];

export function BorrowerQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [borrowers, setBorrowers] = useState<BorrowerQueueItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [lifecycleFilter, setLifecycleFilter] = useState(searchParams.get('stage') || '');
  const [idPendingFilter, setIdPendingFilter] = useState(searchParams.get('id_pending') === 'true');

  useEffect(() => {
    loadBorrowers();
  }, [statusFilter, lifecycleFilter, idPendingFilter]);

  async function loadBorrowers() {
    setLoading(true);
    try {
      let query = supabase
        .from('borrowers')
        .select('*')
        .order('updated_at', { ascending: false });

      if (statusFilter) {
        query = query.eq('borrower_status', statusFilter);
      }

      if (lifecycleFilter) {
        query = query.eq('lifecycle_stage', lifecycleFilter);
      }

      if (idPendingFilter) {
        query = query.eq('id_document_verified', false);
      }

      const { data } = await query.limit(100);
      const rows = (data || []) as BorrowerQueueItem[];

      const brokerIds = Array.from(new Set(rows.map(b => (b as Record<string, unknown>).broker_id as string).filter(Boolean)));
      if (brokerIds.length > 0) {
        const { data: brokers } = await supabase
          .from('user_accounts')
          .select('id, first_name, last_name, email')
          .in('id', brokerIds);
        const byId = new Map((brokers || []).map(b => [b.id, b]));
        for (const r of rows) {
          const brokerId = (r as Record<string, unknown>).broker_id as string | undefined;
          const broker = brokerId ? byId.get(brokerId) : undefined;
          r.owner_name = broker
            ? [broker.first_name, broker.last_name].filter(Boolean).join(' ') || broker.email || 'Owner'
            : undefined;
          r.owner_email = broker?.email || undefined;
        }
      }

      setBorrowers(rows);
    } finally {
      setLoading(false);
    }
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    const params: Record<string, string> = {};
    if (value) params.status = value;
    if (lifecycleFilter) params.stage = lifecycleFilter;
    if (idPendingFilter) params.id_pending = 'true';
    setSearchParams(params);
  };

  const handleLifecycleChange = (value: string) => {
    setLifecycleFilter(value);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (value) params.stage = value;
    if (idPendingFilter) params.id_pending = 'true';
    setSearchParams(params);
  };

  const handleIdPendingChange = (checked: boolean) => {
    setIdPendingFilter(checked);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (lifecycleFilter) params.stage = lifecycleFilter;
    if (checked) params.id_pending = 'true';
    setSearchParams(params);
  };

  const getLifecycleBadge = (stage: LifecycleStage | undefined) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      profile_created: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Profile' },
      loan_type_selected: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Loan Type' },
      documents_uploaded: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Docs Uploaded' },
      liquidity_verified: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'Verified' },
      pre_approved: { bg: 'bg-teal-100', text: 'text-teal-700', label: 'Pre-Approved' },
      application_started: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'App Started' },
      application_submitted: { bg: 'bg-green-100', text: 'text-green-700', label: 'Submitted' },
    };
    const config = configs[stage || 'profile_created'] || configs.profile_created;
    return (
      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const filteredBorrowers = borrowers.filter(b => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const phone = (b.phone || '').replace(/\D/g, '');
    const queryDigits = searchQuery.replace(/\D/g, '');
    return b.borrower_name?.toLowerCase().includes(q)
      || b.email?.toLowerCase().includes(q)
      || (queryDigits && phone.includes(queryDigits))
      || (b as Record<string, unknown>).llc_name?.toString().toLowerCase().includes(q)
      || (b as Record<string, unknown>).address_street?.toString().toLowerCase().includes(q)
      || (b as Record<string, unknown>).address_city?.toString().toLowerCase().includes(q)
      || b.state_of_residence?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Borrower Queue</h1>
          <p className="text-gray-600 mt-1">
            Review and manage borrower applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-gray-400" />
          <span className="text-sm text-gray-600">{filteredBorrowers.length} borrowers</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, phone, LLC, or address..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={lifecycleFilter}
              onChange={e => handleLifecycleChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              {LIFECYCLE_STAGES.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => handleStatusChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              {STATUS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={idPendingFilter}
                onChange={e => handleIdPendingChange(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <Shield className="w-4 h-4 text-amber-500" />
                ID Pending
              </span>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredBorrowers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">No borrowers found</p>
            {(searchQuery || statusFilter || lifecycleFilter || idPendingFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('');
                  setLifecycleFilter('');
                  setIdPendingFilter(false);
                  setSearchParams({});
                }}
                className="text-teal-600 font-medium text-sm mt-2 hover:text-teal-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Borrower
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stage
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Owner
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Loan Type
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Credit
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBorrowers.map(borrower => (
                  <tr key={borrower.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{borrower.borrower_name}</p>
                        <p className="text-sm text-gray-500">{borrower.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getLifecycleBadge(borrower.lifecycle_stage)}
                    </td>
                    <td className="px-6 py-4">
                      {borrower.owner_name ? (
                        <div>
                          <p className="text-sm text-gray-900">{borrower.owner_name}</p>
                          {borrower.owner_email && (
                            <p className="text-xs text-gray-500">{borrower.owner_email}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">
                        {borrower.preferred_loan_type
                          ? borrower.preferred_loan_type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                          : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {borrower.credit_score ? (
                        <span className={`font-medium ${
                          borrower.credit_score >= 740 ? 'text-green-600' :
                          borrower.credit_score >= 680 ? 'text-amber-600' :
                          'text-red-600'
                        }`}>
                          {borrower.credit_score}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {borrower.id_document_verified ? (
                        <Shield className="w-4 h-4 text-green-500" />
                      ) : (
                        <Shield className="w-4 h-4 text-gray-300" />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500">
                        {borrower.updated_at ? new Date(borrower.updated_at).toLocaleDateString() : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/internal/my-borrowers/${borrower.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                      >
                        View <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
