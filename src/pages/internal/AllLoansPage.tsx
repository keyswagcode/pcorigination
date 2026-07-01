import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { Briefcase, Loader2, Search, ArrowRight } from 'lucide-react';

interface LoanRow {
  id: string;
  scenario_name: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  loan_amount: number | null;
  ltv: number | null;
  status: string;
  created_at: string;
  borrower_id: string;
  borrower_name?: string;
  borrower_email?: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-amber-100 text-amber-700',
  under_review: 'bg-blue-100 text-blue-700',
  approved: 'bg-teal-100 text-teal-700',
  declined: 'bg-red-100 text-red-700',
  closed: 'bg-purple-100 text-purple-700',
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  dscr: 'DSCR',
  fix_flip: 'Fix & Flip',
  bridge: 'Bridge',
  ground_up: 'Ground-Up Construction',
  bank_statement: 'Bank Statement',
};

export function AllLoansPage() {
  const { userAccount } = useAuth();
  const { member } = useTeam();
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const isAdminLike =
    userAccount?.user_role === 'admin' ||
    userAccount?.user_role === 'reviewer' ||
    member?.role === 'owner' ||
    member?.role === 'admin';

  // Server-side paged fetch — fetching the whole table silently truncates at
  // PostgREST's 1000-row cap and gets heavy long before that.
  const PAGE = 100;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    let query = supabase
      .from('loan_scenarios')
      .select('id, scenario_name, loan_type, loan_purpose, loan_amount, ltv, status, created_at, borrower_id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, page * PAGE - 1);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (search.trim()) {
      // Search scenario/loan-type server-side; borrower name resolves below.
      const q = search.trim().replace(/[%_,()]/g, '');
      query = query.or(`scenario_name.ilike.%${q}%,loan_type.ilike.%${q}%`);
    }
    const { data: loanData, count } = await query;
    setTotalCount(count ?? null);

    if (!loanData || loanData.length === 0) {
      setLoans([]);
      setIsLoading(false);
      return;
    }

    const borrowerIds = Array.from(new Set(loanData.map(l => l.borrower_id)));
    const { data: borrowerData } = await supabase
      .from('borrowers')
      .select('id, borrower_name, email')
      .in('id', borrowerIds);

    const byId = new Map((borrowerData || []).map(b => [b.id, b]));
    setLoans(loanData.map(l => ({
      ...l,
      borrower_name: byId.get(l.borrower_id)?.borrower_name || 'Unknown',
      borrower_email: byId.get(l.borrower_id)?.email || undefined,
    })));
    setIsLoading(false);
  }, [page, statusFilter, search]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(1); }, [statusFilter, search]);

  const visibleLoans = loans;

  const fmtCurrency = (n: number | null) =>
    n ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n) : '—';

  if (!isAdminLike) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">You don't have permission to view all loans.</p>
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

  const statuses = ['all', 'submitted', 'under_review', 'approved', 'declined', 'closed', 'draft'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">All Loans</h1>
        <p className="text-gray-500 mt-1">
          {totalCount != null ? `${totalCount} matching` : `${loans.length}`} · showing {loans.length}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {statuses.map(s => {
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
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
          placeholder="Search by scenario name or loan type..."
        />
      </div>

      {visibleLoans.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
          <Briefcase className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No loans match the current filter.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Borrower</th>
                <th className="text-left px-4 py-3 font-medium">Scenario</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-right px-4 py-3 font-medium">LTV</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleLoans.map(l => (
                <tr key={l.id} className="hover:bg-teal-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/internal/my-borrowers/${l.borrower_id}`} className="block">
                      <p className="font-medium text-gray-900">{l.borrower_name}</p>
                      {l.borrower_email && <p className="text-xs text-gray-500">{l.borrower_email}</p>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{l.scenario_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{LOAN_TYPE_LABELS[l.loan_type || ''] || l.loan_type || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{fmtCurrency(l.loan_amount)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{l.ltv ? `${l.ltv.toFixed(1)}%` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[l.status] || 'bg-gray-100 text-gray-600'}`}>
                      {l.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(l.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/internal/loans/${l.id}/review`} className="inline-flex items-center gap-1 text-teal-700 text-xs font-medium hover:text-teal-900">
                      Review <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount != null && loans.length < totalCount && (
        <div className="text-center">
          <button
            onClick={() => setPage(p => p + 1)}
            className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Load more ({loans.length} of {totalCount})
          </button>
        </div>
      )}
    </div>
  );
}
