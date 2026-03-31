import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Users, Search, Loader2, ArrowRight } from 'lucide-react';

interface BorrowerRow {
  id: string;
  borrower_name: string;
  email: string | null;
  credit_score: number | null;
  lifecycle_stage: string | null;
  borrower_status: string | null;
  created_at: string;
  updated_at: string;
  loan_count?: number;
}

const STAGE_LABELS: Record<string, string> = {
  profile_created: 'New',
  documents_uploaded: 'Docs Uploaded',
  liquidity_verified: 'Liquidity Verified',
  pre_approved: 'Pre-Approved',
  application_submitted: 'App Submitted',
};

const STAGE_COLORS: Record<string, string> = {
  profile_created: 'bg-gray-100 text-gray-600',
  documents_uploaded: 'bg-blue-100 text-blue-700',
  liquidity_verified: 'bg-cyan-100 text-cyan-700',
  pre_approved: 'bg-teal-100 text-teal-700',
  application_submitted: 'bg-green-100 text-green-700',
};

export function BrokerBorrowersPage() {
  const { user } = useAuth();
  const [borrowers, setBorrowers] = useState<BorrowerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const { data } = await supabase
        .from('borrowers')
        .select('id, borrower_name, email, credit_score, lifecycle_stage, borrower_status, created_at, updated_at')
        .eq('broker_id', user.id)
        .order('created_at', { ascending: false });
      setBorrowers(data || []);
      setIsLoading(false);
    }
    loadData();
  }, [user]);

  const filtered = borrowers.filter(b => {
    if (search) {
      const q = search.toLowerCase();
      if (!b.borrower_name.toLowerCase().includes(q) && !(b.email || '').toLowerCase().includes(q)) return false;
    }
    if (stageFilter !== 'all' && b.lifecycle_stage !== stageFilter) return false;
    return true;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">My Borrowers</h1>
        <p className="text-gray-500 mt-1">{borrowers.length} total borrowers</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="Search by name or email..."
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          <option value="all">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-12 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{search || stageFilter !== 'all' ? 'No borrowers match your filters' : 'No borrowers yet'}</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Borrower</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Credit Score</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Stage</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-gray-900">{b.borrower_name}</p>
                    <p className="text-xs text-gray-500">{b.email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-900">{b.credit_score || '—'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STAGE_COLORS[b.lifecycle_stage || ''] || 'bg-gray-100 text-gray-600'}`}>
                      {STAGE_LABELS[b.lifecycle_stage || ''] || b.lifecycle_stage || 'New'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-500">{new Date(b.created_at).toLocaleDateString()}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      to={`/internal/my-borrowers/${b.id}`}
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
  );
}
