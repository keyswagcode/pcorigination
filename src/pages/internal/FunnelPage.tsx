import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { Loader2, TrendingUp, Users, ChevronRight } from 'lucide-react';

interface FunnelCounts {
  signUps: number;
  bankLinked: number;
  liquidityVerified: number;
  preApproved: number;
  loansSubmitted: number;
}

interface AeRow {
  brokerId: string | null;
  name: string;
  email: string | null;
  signUps: number;
  preApproved: number;
}

type Period = 'all' | '30d';

const EMPTY_COUNTS: FunnelCounts = {
  signUps: 0,
  bankLinked: 0,
  liquidityVerified: 0,
  preApproved: 0,
  loansSubmitted: 0,
};

async function fetchFunnelCounts(since: string | null): Promise<FunnelCounts> {
  let signUpsQ = supabase.from('borrowers').select('id', { count: 'exact', head: true });
  if (since) signUpsQ = signUpsQ.gte('created_at', since);

  let bankLinkedQ = supabase
    .from('borrowers')
    .select('id', { count: 'exact', head: true })
    .not('plaid_user_id', 'is', null);
  if (since) bankLinkedQ = bankLinkedQ.gte('created_at', since);

  let liquidityQ = supabase
    .from('borrower_financial_profiles')
    .select('id', { count: 'exact', head: true });
  if (since) liquidityQ = liquidityQ.gte('created_at', since);

  // Distinct borrowers with a pre-approval — table is small, so fetch ids and
  // Set-size in JS (head counts would double-count multi-approval borrowers).
  let preApprovalsQ = supabase.from('pre_approvals').select('borrower_id');
  if (since) preApprovalsQ = preApprovalsQ.gte('created_at', since);

  let submittedQ = supabase
    .from('loan_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'submitted');
  if (since) submittedQ = submittedQ.gte('created_at', since);

  const [signUps, bankLinked, liquidity, preApprovals, submitted] = await Promise.all([
    signUpsQ,
    bankLinkedQ,
    liquidityQ,
    preApprovalsQ.limit(10000),
    submittedQ,
  ]);

  const preApprovedBorrowers = new Set(
    ((preApprovals.data as { borrower_id: string | null }[] | null) || [])
      .map(r => r.borrower_id)
      .filter((id): id is string => id != null)
  );

  return {
    signUps: signUps.count ?? 0,
    bankLinked: bankLinked.count ?? 0,
    liquidityVerified: liquidity.count ?? 0,
    preApproved: preApprovedBorrowers.size,
    loansSubmitted: submitted.count ?? 0,
  };
}

async function fetchAeRows(): Promise<AeRow[]> {
  const [{ data: borrowerData }, { data: preApprovalData }] = await Promise.all([
    supabase.from('borrowers').select('id, broker_id').limit(10000),
    supabase.from('pre_approvals').select('borrower_id').limit(10000),
  ]);

  const borrowers = (borrowerData as { id: string; broker_id: string | null }[] | null) || [];
  const borrowerToBroker = new Map<string, string | null>(
    borrowers.map(b => [b.id, b.broker_id])
  );

  // Sign-ups per broker
  const signUpsByBroker = new Map<string | null, number>();
  for (const b of borrowers) {
    signUpsByBroker.set(b.broker_id, (signUpsByBroker.get(b.broker_id) || 0) + 1);
  }

  // Distinct pre-approved borrowers, then attribute each to their broker
  const preApprovedBorrowers = new Set(
    ((preApprovalData as { borrower_id: string | null }[] | null) || [])
      .map(r => r.borrower_id)
      .filter((id): id is string => id != null)
  );
  const preApprovedByBroker = new Map<string | null, number>();
  for (const borrowerId of preApprovedBorrowers) {
    if (!borrowerToBroker.has(borrowerId)) continue;
    const brokerId = borrowerToBroker.get(borrowerId) ?? null;
    preApprovedByBroker.set(brokerId, (preApprovedByBroker.get(brokerId) || 0) + 1);
  }

  const brokerIds = Array.from(signUpsByBroker.keys()).filter(
    (id): id is string => id != null
  );
  let accounts: { id: string; first_name: string | null; last_name: string | null; email: string | null }[] = [];
  if (brokerIds.length > 0) {
    const { data } = await supabase
      .from('user_accounts')
      .select('id, first_name, last_name, email')
      .in('id', brokerIds);
    accounts = (data as typeof accounts | null) || [];
  }
  const accountById = new Map(accounts.map(a => [a.id, a]));

  const rows: AeRow[] = Array.from(signUpsByBroker.entries()).map(([brokerId, signUps]) => {
    if (brokerId == null) {
      return {
        brokerId: null,
        name: 'Unassigned',
        email: null,
        signUps,
        preApproved: preApprovedByBroker.get(null) || 0,
      };
    }
    const acct = accountById.get(brokerId);
    const name = acct
      ? [acct.first_name, acct.last_name].filter(Boolean).join(' ') || acct.email || 'Unknown AE'
      : 'Unknown AE';
    return {
      brokerId,
      name,
      email: acct?.email || null,
      signUps,
      preApproved: preApprovedByBroker.get(brokerId) || 0,
    };
  });

  rows.sort((a, b) => b.signUps - a.signUps);
  return rows;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export function FunnelPage() {
  const { userAccount } = useAuth();
  const { member } = useTeam();
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('all');
  const [allTime, setAllTime] = useState<FunnelCounts>(EMPTY_COUNTS);
  const [last30, setLast30] = useState<FunnelCounts>(EMPTY_COUNTS);
  const [aeRows, setAeRows] = useState<AeRow[]>([]);

  const isAdminLike =
    userAccount?.user_role === 'admin' ||
    userAccount?.user_role === 'reviewer' ||
    member?.role === 'owner' ||
    member?.role === 'admin';

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const iso30DaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [all, recent, rows] = await Promise.all([
        fetchFunnelCounts(null),
        fetchFunnelCounts(iso30DaysAgo),
        fetchAeRows(),
      ]);
      setAllTime(all);
      setLast30(recent);
      setAeRows(rows);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdminLike) return;
    loadData();
  }, [isAdminLike, loadData]);

  if (!isAdminLike) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">You don't have permission to view funnel analytics.</p>
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

  const counts = period === 'all' ? allTime : last30;
  const stages = [
    { label: 'Sign-ups', value: counts.signUps, prev: null as number | null },
    { label: 'Bank Linked', value: counts.bankLinked, prev: counts.signUps },
    { label: 'Liquidity Verified', value: counts.liquidityVerified, prev: counts.bankLinked },
    { label: 'Pre-approved', value: counts.preApproved, prev: counts.liquidityVerified },
    { label: 'Loans Submitted', value: counts.loansSubmitted, prev: counts.preApproved },
  ];
  const prevLabels = ['', 'sign-ups', 'bank linked', 'liquidity verified', 'pre-approved'];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Funnel</h1>
          <p className="text-gray-500 mt-1">Borrower acquisition funnel and per-AE conversion</p>
        </div>
        <div className="flex items-center gap-2">
          {([
            { key: 'all', label: 'All time' },
            { key: '30d', label: 'Last 30 days' },
          ] as { key: Period; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                period === key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {stages.map((stage, i) => (
          <div key={stage.label} className="relative border border-gray-200 rounded-xl bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{stage.label}</p>
              {i > 0 && (
                <ChevronRight className="w-4 h-4 text-gray-300 hidden lg:block absolute -left-3.5 top-1/2 -translate-y-1/2 bg-gray-100 rounded-full" />
              )}
            </div>
            <p className="text-3xl font-semibold text-gray-900 mt-2">{stage.value.toLocaleString()}</p>
            {stage.prev != null ? (
              <p className="text-xs text-teal-700 mt-1">
                {pct(stage.value, stage.prev)} of {prevLabels[i]}
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Top of funnel</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-teal-600" />
          <h2 className="text-lg font-semibold text-gray-900">By Account Executive</h2>
          <span className="text-xs text-gray-400">(all time)</span>
        </div>
        {aeRows.length === 0 ? (
          <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No borrower sign-ups yet.</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">AE</th>
                  <th className="text-right px-4 py-3 font-medium">Sign-ups</th>
                  <th className="text-right px-4 py-3 font-medium">Pre-approved</th>
                  <th className="text-right px-4 py-3 font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {aeRows.map(row => (
                  <tr key={row.brokerId ?? 'unassigned'} className="hover:bg-teal-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className={`font-medium ${row.brokerId ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                        {row.name}
                      </p>
                      {row.email && <p className="text-xs text-gray-500">{row.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{row.signUps.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{row.preApproved.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-teal-700 font-medium">
                      {pct(row.preApproved, row.signUps)}
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
