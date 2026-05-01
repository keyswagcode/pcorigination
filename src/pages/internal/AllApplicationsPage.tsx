import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ClipboardList, Loader2, Search, ArrowRight } from 'lucide-react';

interface ApplicationRow {
  id: string;
  borrower_id: string | null;
  status: string;
  processing_stage: string | null;
  created_at: string;
  submitted_at: string | null;
  updated_at: string | null;
  borrower_name?: string;
  borrower_email?: string;
  loan_amount?: number | null;
  loan_purpose?: string | null;
  property_address?: string | null;
  property_state?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-amber-100 text-amber-700',
  documents_processing: 'bg-blue-100 text-blue-700',
  documents_processed: 'bg-blue-100 text-blue-700',
  under_review: 'bg-blue-100 text-blue-700',
  prequalified: 'bg-teal-100 text-teal-700',
  approved: 'bg-teal-100 text-teal-700',
  conditionally_approved: 'bg-teal-100 text-teal-700',
  declined: 'bg-red-100 text-red-700',
  additional_docs_requested: 'bg-amber-100 text-amber-700',
};

const STAGE_LABELS: Record<string, string> = {
  intake_received: 'Intake Received',
  documents_uploading: 'Uploading Docs',
  documents_processing: 'Processing Docs',
  documents_processed: 'Docs Processed',
  documents_failed: 'Docs Failed',
  review: 'Under Review',
  underwriting: 'Underwriting',
  pre_approval: 'Pre-Approval',
  pre_approval_complete: 'Pre-Approved',
  approved: 'Approved',
  completed: 'Completed',
};

export function AllApplicationsPage() {
  const { userAccount } = useAuth();
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const isAdminLike = userAccount?.user_role === 'admin' || userAccount?.user_role === 'reviewer';

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const { data: subs } = await supabase
      .from('intake_submissions')
      .select(`
        id,
        borrower_id,
        status,
        processing_stage,
        created_at,
        submitted_at,
        updated_at,
        loan_requests (requested_amount, loan_purpose),
        properties (property_address, property_state)
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (!subs || subs.length === 0) {
      setApps([]);
      setIsLoading(false);
      return;
    }

    const borrowerIds = Array.from(new Set(subs.map(s => s.borrower_id).filter(Boolean) as string[]));
    const { data: borrowerData } = await supabase
      .from('borrowers')
      .select('id, borrower_name, email')
      .in('id', borrowerIds);

    const byId = new Map((borrowerData || []).map(b => [b.id, b]));
    setApps(subs.map(s => {
      const lr = (s.loan_requests as Array<Record<string, unknown>> | null)?.[0];
      const prop = (s.properties as Array<Record<string, unknown>> | null)?.[0];
      return {
        id: s.id,
        borrower_id: s.borrower_id,
        status: s.status,
        processing_stage: s.processing_stage,
        created_at: s.created_at,
        submitted_at: s.submitted_at,
        updated_at: s.updated_at,
        borrower_name: (s.borrower_id && byId.get(s.borrower_id)?.borrower_name) || 'Unknown',
        borrower_email: s.borrower_id ? byId.get(s.borrower_id)?.email || undefined : undefined,
        loan_amount: lr?.requested_amount as number | undefined,
        loan_purpose: lr?.loan_purpose as string | undefined,
        property_address: prop?.property_address as string | undefined,
        property_state: prop?.property_state as string | undefined,
      };
    }));
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const fmtCurrency = (n: number | null | undefined) =>
    n ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n) : '—';

  const statusOptions = ['all', 'submitted', 'documents_processing', 'under_review', 'prequalified', 'approved', 'conditionally_approved', 'additional_docs_requested', 'declined', 'draft'];
  const statusCounts = apps.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  const visibleApps = apps
    .filter(a => statusFilter === 'all' || a.status === statusFilter)
    .filter(a => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (a.borrower_name || '').toLowerCase().includes(q)
        || (a.borrower_email || '').toLowerCase().includes(q)
        || (a.property_address || '').toLowerCase().includes(q)
        || (a.property_state || '').toLowerCase().includes(q);
    });

  if (!isAdminLike) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">You don't have permission to view all applications.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">All Applications</h1>
        <p className="text-gray-500 mt-1">{apps.length} applications across all borrowers (most recent 500)</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {statusOptions.map(s => {
          const count = s === 'all' ? apps.length : statusCounts[s] || 0;
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} ({count})
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          placeholder="Search by borrower name, email, property address, or state..."
        />
      </div>

      {visibleApps.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No applications match the current filter.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Borrower</th>
                <th className="text-left px-4 py-3 font-medium">Property</th>
                <th className="text-right px-4 py-3 font-medium">Requested</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleApps.map(a => (
                <tr key={a.id} className="hover:bg-teal-50 transition-colors">
                  <td className="px-4 py-3">
                    {a.borrower_id ? (
                      <Link to={`/internal/my-borrowers/${a.borrower_id}`} className="block">
                        <p className="font-medium text-gray-900">{a.borrower_name}</p>
                        {a.borrower_email && <p className="text-xs text-gray-500">{a.borrower_email}</p>}
                      </Link>
                    ) : (
                      <p className="text-gray-500">Unassigned</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {a.property_address ? (
                      <>
                        <p>{a.property_address}</p>
                        {a.property_state && <p className="text-xs text-gray-500">{a.property_state}</p>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">{fmtCurrency(a.loan_amount)}</td>
                  <td className="px-4 py-3 text-gray-700 text-xs">
                    {STAGE_LABELS[a.processing_stage || ''] || a.processing_stage || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[a.status] || 'bg-gray-100 text-gray-600'}`}>
                      {a.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.borrower_id && (
                      <Link
                        to={`/internal/my-borrowers/${a.borrower_id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                      >
                        View <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
