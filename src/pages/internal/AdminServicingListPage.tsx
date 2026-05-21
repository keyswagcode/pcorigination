import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, PiggyBank, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { listServicedLoansForOrg } from '../../services/servicingService';
import type { ServicedLoan, ServicingStatus } from '../../shared/types';

const STATUS_BADGE: Record<ServicingStatus, string> = {
  active: 'bg-teal-100 text-teal-800',
  paid_off: 'bg-gray-200 text-gray-700',
  delinquent: 'bg-amber-100 text-amber-800',
  in_foreclosure: 'bg-red-100 text-red-800',
  transferred: 'bg-blue-100 text-blue-800',
};

export function AdminServicingListPage() {
  const { userAccount } = useAuth();
  const { member } = useTeam();
  const [loans, setLoans] = useState<ServicedLoan[]>([]);
  const [borrowerNames, setBorrowerNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<ServicingStatus | 'all'>('all');

  const isAdminLike =
    userAccount?.user_role === 'admin' ||
    userAccount?.user_role === 'reviewer' ||
    member?.role === 'owner' ||
    member?.role === 'admin';

  useEffect(() => {
    if (!isAdminLike) { setIsLoading(false); return; }
    (async () => {
      try {
        const rows = await listServicedLoansForOrg();
        setLoans(rows);
        const borrowerIds = Array.from(new Set(rows.map(r => r.borrower_id)));
        if (borrowerIds.length > 0) {
          const { data: bs } = await supabase
            .from('borrowers')
            .select('id, borrower_name')
            .in('id', borrowerIds);
          const map: Record<string, string> = {};
          for (const b of bs || []) map[b.id] = b.borrower_name;
          setBorrowerNames(map);
        }
      } finally { setIsLoading(false); }
    })();
  }, [isAdminLike]);

  if (!isAdminLike) {
    return <div className="text-center py-20"><p className="text-gray-500">You don't have permission to view loan servicing.</p></div>;
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  const visible = filter === 'all' ? loans : loans.filter(l => l.servicing_status === filter);
  const counts = loans.reduce<Record<string, number>>((acc, l) => {
    acc[l.servicing_status] = (acc[l.servicing_status] || 0) + 1;
    return acc;
  }, {});
  const statuses: (ServicingStatus | 'all')[] = ['all', 'active', 'delinquent', 'paid_off', 'in_foreclosure', 'transferred'];

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Loan Servicing</h1>
          <p className="text-gray-500 mt-1">{loans.length} loan{loans.length === 1 ? '' : 's'} under management</p>
        </div>
        <Link
          to="/internal/servicing/new"
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
        >
          <Plus className="w-4 h-4" /> Onboard a Loan
        </Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {statuses.map(s => {
          const count = s === 'all' ? loans.length : counts[s] || 0;
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${active ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-12 text-center">
          <PiggyBank className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{filter === 'all' ? 'No serviced loans yet. Onboard your first closed loan above.' : 'No loans in this status.'}</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Loan #</th>
                <th className="text-left px-4 py-3 font-medium">Borrower</th>
                <th className="text-right px-4 py-3 font-medium">Original</th>
                <th className="text-right px-4 py-3 font-medium">Current Bal.</th>
                <th className="text-right px-4 py-3 font-medium">Rate</th>
                <th className="text-left px-4 py-3 font-medium">Next Due</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(l => (
                <tr key={l.id} className="hover:bg-teal-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{l.loan_number}</td>
                  <td className="px-4 py-3 text-gray-900">{borrowerNames[l.borrower_id] || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtCurrency(l.original_principal)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{fmtCurrency(l.current_principal)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{(l.interest_rate * 100).toFixed(3)}%</td>
                  <td className="px-4 py-3 text-gray-700">{l.next_payment_due_date || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_BADGE[l.servicing_status]}`}>
                      {l.servicing_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/internal/servicing/${l.id}`} className="inline-flex items-center gap-1 text-teal-700 text-xs font-medium hover:text-teal-900">
                      Manage <ArrowRight className="w-3.5 h-3.5" />
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
