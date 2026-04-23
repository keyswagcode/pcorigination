import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import {
  Users, FileText, CheckCircle2, Clock, AlertCircle,
  DollarSign, Loader2, Copy, Check, ArrowRight, Search
} from 'lucide-react';
import { logAudit } from '../../services/auditService';
import type { OrganizationMember } from '../../shared/types';

/** Returns the list of user_ids whose borrowers the current member can see */
function getVisibleBrokerIds(member: OrganizationMember, members: OrganizationMember[]): string[] {
  const role = member.role;
  if (role === 'owner' || role === 'admin') {
    // Owner/Admin see all borrowers in the org
    return members.map(m => m.user_id);
  }
  if (role === 'vp') {
    // VP sees their own + anyone they invited
    const inviteeIds = members
      .filter(m => m.invited_by_user_id === member.user_id)
      .map(m => m.user_id);
    return [member.user_id, ...inviteeIds];
  }
  // AE sees only their own
  return [member.user_id];
}

interface BorrowerSummary {
  id: string;
  borrower_name: string;
  email: string | null;
  credit_score: number | null;
  lifecycle_stage: string | null;
  borrower_status: string | null;
  created_at: string;
}

interface LoanPending {
  id: string;
  scenario_name: string;
  loan_type: string | null;
  loan_amount: number | null;
  status: string;
  borrower_id: string;
  borrower_name?: string;
}

const STAGE_LABELS: Record<string, string> = {
  profile_created: 'New',
  loan_type_selected: 'Loan Type Selected',
  documents_uploaded: 'Docs Uploaded',
  liquidity_verified: 'Liquidity Verified',
  pre_approved: 'Pre-Approved',
  application_started: 'App Started',
  application_submitted: 'App Submitted',
};

const STAGE_COLORS: Record<string, string> = {
  profile_created: 'bg-gray-100 text-gray-600',
  documents_uploaded: 'bg-blue-100 text-blue-700',
  liquidity_verified: 'bg-cyan-100 text-cyan-700',
  pre_approved: 'bg-teal-100 text-teal-700',
  application_submitted: 'bg-green-100 text-green-700',
};

const PIPELINE_STAGES = [
  { key: 'profile_created', label: 'New' },
  { key: 'pre_approved', label: 'Pre-Approved' },
  { key: 'order_appraisal', label: 'Order Appraisal' },
  { key: 'underwriting', label: 'Underwriting' },
  { key: 'ctc', label: 'CTC' },
  { key: 'closed_won', label: 'Closed Won' },
];

export function BrokerDashboardPage() {
  const { user, userAccount } = useAuth();
  const { member, members } = useTeam();
  const [borrowers, setBorrowers] = useState<BorrowerSummary[]>([]);
  const [pendingLoans, setPendingLoans] = useState<LoanPending[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');
  const [dragBorrowerId, setDragBorrowerId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!user) return;

      const isAdminLike = userAccount?.user_role === 'admin'
        || member?.role === 'admin'
        || member?.role === 'owner';

      let borrowersQuery = supabase
        .from('borrowers')
        .select('id, borrower_name, email, credit_score, lifecycle_stage, borrower_status, created_at')
        .order('created_at', { ascending: false });

      if (!isAdminLike) {
        if (!member) return;
        const visibleBrokerIds = getVisibleBrokerIds(member, members);
        borrowersQuery = borrowersQuery.in('broker_id', visibleBrokerIds);
      }

      const { data: borrowerData } = await borrowersQuery;
      setBorrowers(borrowerData || []);

      // Fetch pending loans
      if (borrowerData && borrowerData.length > 0) {
        const borrowerIds = borrowerData.map(b => b.id);
        const { data: loans } = await supabase
          .from('loan_scenarios')
          .select('id, scenario_name, loan_type, loan_amount, status, borrower_id')
          .in('borrower_id', borrowerIds)
          .eq('status', 'submitted')
          .order('created_at', { ascending: false });

        if (loans) {
          const loansWithNames = loans.map(l => ({
            ...l,
            borrower_name: borrowerData.find(b => b.id === l.borrower_id)?.borrower_name || 'Unknown',
          }));
          setPendingLoans(loansWithNames);
        }
      }

      setIsLoading(false);
    }
    loadData();
  }, [user, userAccount, member, members]);

  const handleDrop = async (borrowerId: string, newStage: string) => {
    setDragBorrowerId(null);
    setDragOverStage(null);

    // Optimistic update
    setBorrowers(prev => prev.map(b =>
      b.id === borrowerId ? { ...b, lifecycle_stage: newStage } : b
    ));

    // Save to DB
    const oldStage = borrowers.find(b => b.id === borrowerId)?.lifecycle_stage || 'profile_created';
    await supabase.from('borrowers')
      .update({ lifecycle_stage: newStage })
      .eq('id', borrowerId);

    // Audit trail
    if (user) {
      const oldLabel = PIPELINE_STAGES.find(s => s.key === oldStage)?.label || oldStage;
      const newLabel = PIPELINE_STAGES.find(s => s.key === newStage)?.label || newStage;
      logAudit({
        borrowerId, userId: user.id, action: 'updated', entityType: 'borrower',
        entityId: borrowerId, fieldName: 'pipeline_stage', oldValue: oldLabel, newValue: newLabel,
      });
    }

    // Log activity
    const borrower = borrowers.find(b => b.id === borrowerId);
    const stageLabel = PIPELINE_STAGES.find(s => s.key === newStage)?.label || newStage;
    if (borrower && user) {
      supabase.from('borrower_activity_log').insert({
        borrower_id: borrowerId,
        user_id: user.id,
        event_type: 'stage_changed',
        title: `Moved to ${stageLabel}`,
        details: `Pipeline stage changed to ${stageLabel}`,
      });
    }
  };

  const posSlug = userAccount?.pos_slug;
  const posUrl = posSlug ? `${window.location.origin}/apply/${posSlug}` : null;

  const handleCopy = () => {
    if (posUrl) {
      navigator.clipboard.writeText(posUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getPipelineCounts = () => {
    const counts: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) counts[stage.key] = 0;
    for (const b of borrowers) {
      const stage = b.lifecycle_stage || 'profile_created';
      if (counts[stage] !== undefined) counts[stage]++;
    }
    return counts;
  };

  const pipelineCounts = getPipelineCounts();

  const pendingLoanCountByBorrower = pendingLoans.reduce<Record<string, number>>((acc, l) => {
    acc[l.borrower_id] = (acc[l.borrower_id] || 0) + 1;
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-gray-500 mt-1">Your borrower pipeline at a glance</p>
        </div>
      </div>

      {/* POS Link */}
      {posUrl && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Your Application Link</p>
            <p className="text-sm text-teal-600 font-mono mt-0.5">{posUrl}</p>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      )}

      {/* Pipeline Kanban - Drag & Drop */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Pipeline</h2>
        <div className="grid grid-cols-6 gap-3">
          {PIPELINE_STAGES.map(stage => {
            const count = pipelineCounts[stage.key];
            const stageBorrowers = borrowers.filter(b => (b.lifecycle_stage || 'profile_created') === stage.key);
            const isOver = dragOverStage === stage.key;

            return (
              <div
                key={stage.key}
                className={`border-2 rounded-xl overflow-hidden transition-colors ${
                  isOver ? 'border-teal-500 bg-teal-50/50' : 'border-gray-200 bg-white'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.key); }}
                onDragEnter={e => { e.preventDefault(); setDragOverStage(stage.key); }}
                onDragLeave={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX; const y = e.clientY;
                  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                    setDragOverStage(null);
                  }
                }}
                onDrop={e => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('borrowerId');
                  if (id) handleDrop(id, stage.key);
                }}
              >
                <div className={`px-4 py-3 border-b flex items-center justify-between ${
                  isOver ? 'bg-teal-100 border-teal-200' : 'bg-gray-50 border-gray-200'
                }`}>
                  <span className={`text-sm font-medium ${isOver ? 'text-teal-800' : 'text-gray-700'}`}>{stage.label}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    isOver ? 'bg-teal-200 text-teal-800' : 'bg-gray-200 text-gray-700'
                  }`}>{count}</span>
                </div>
                <div className={`p-2 space-y-2 min-h-[120px] max-h-[400px] overflow-y-auto ${
                  isOver && stageBorrowers.length === 0 ? 'flex items-center justify-center' : ''
                }`}>
                  {isOver && stageBorrowers.length === 0 && (
                    <p className="text-xs text-teal-600 font-medium">Drop here</p>
                  )}
                  {stageBorrowers.map(b => (
                    <div
                      key={b.id}
                      draggable
                      onDragStart={e => {
                        setDragBorrowerId(b.id);
                        e.dataTransfer.setData('borrowerId', b.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => { setDragBorrowerId(null); setDragOverStage(null); }}
                      className={`p-3 rounded-lg cursor-grab active:cursor-grabbing transition-all ${
                        dragBorrowerId === b.id
                          ? 'opacity-40 bg-gray-100'
                          : 'bg-gray-50 hover:bg-teal-50 hover:shadow-sm'
                      }`}
                    >
                      <Link to={`/internal/my-borrowers/${b.id}`} className="block relative" onClick={e => { if (dragBorrowerId) e.preventDefault(); }}>
                        <p className="text-sm font-medium text-gray-900 truncate pr-6">{b.borrower_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{b.credit_score ? `${b.credit_score} CS` : 'No CS'}</p>
                        {pendingLoanCountByBorrower[b.id] > 0 && (
                          <span
                            title={`${pendingLoanCountByBorrower[b.id]} pending loan${pendingLoanCountByBorrower[b.id] === 1 ? '' : 's'}`}
                            className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
                          >
                            {pendingLoanCountByBorrower[b.id]}
                          </span>
                        )}
                      </Link>
                    </div>
                  ))}
                  {stageBorrowers.length === 0 && !isOver && (
                    <p className="text-xs text-gray-400 text-center py-4">None</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="Search by borrower name, LLC, property, phone, or email..."
          />
        </div>

        {search && (() => {
          const q = search.toLowerCase();
          const results = borrowers.filter(b =>
            b.borrower_name.toLowerCase().includes(q) ||
            (b.email || '').toLowerCase().includes(q) ||
            (b.credit_score && String(b.credit_score).includes(q))
          );

          // Also search loans
          const loanResults = pendingLoans.filter(l =>
            (l.scenario_name || '').toLowerCase().includes(q) ||
            (l.borrower_name || '').toLowerCase().includes(q)
          );

          return (
            <div className="mt-3 border border-gray-200 rounded-xl bg-white divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
              {results.length === 0 && loanResults.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-500 text-center">No results found</p>
              )}
              {results.map(b => (
                <Link key={b.id} to={`/internal/my-borrowers/${b.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-teal-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.borrower_name}</p>
                    <p className="text-xs text-gray-500">{b.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pendingLoanCountByBorrower[b.id] > 0 && (
                      <span
                        title={`${pendingLoanCountByBorrower[b.id]} pending loan${pendingLoanCountByBorrower[b.id] === 1 ? '' : 's'}`}
                        className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
                      >
                        {pendingLoanCountByBorrower[b.id]}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STAGE_COLORS[b.lifecycle_stage || ''] || 'bg-gray-100 text-gray-600'}`}>
                      {STAGE_LABELS[b.lifecycle_stage || ''] || 'New'}
                    </span>
                  </div>
                </Link>
              ))}
              {loanResults.map(l => (
                <Link key={l.id} to={`/internal/loans/${l.id}/review`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-teal-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{l.scenario_name}</p>
                    <p className="text-xs text-gray-500">{l.borrower_name} &middot; Loan</p>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">{l.status}</span>
                </Link>
              ))}
            </div>
          );
        })()}
      </div>

      {/* New Borrowers */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">New Borrowers</h2>
        {(() => {
          const newBorrowers = borrowers.filter(b => (b.lifecycle_stage || 'profile_created') === 'profile_created');
          return newBorrowers.length === 0 ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No new borrowers</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
              {newBorrowers.map(b => (
                <Link key={b.id} to={`/internal/my-borrowers/${b.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-teal-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-teal-100 rounded-full flex items-center justify-center">
                      <span className="text-xs font-medium text-teal-700">
                        {b.borrower_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.borrower_name}</p>
                      <p className="text-xs text-gray-500">{b.email} {b.credit_score ? `· ${b.credit_score} CS` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {pendingLoanCountByBorrower[b.id] > 0 && (
                      <span
                        title={`${pendingLoanCountByBorrower[b.id]} pending loan${pendingLoanCountByBorrower[b.id] === 1 ? '' : 's'}`}
                        className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
                      >
                        {pendingLoanCountByBorrower[b.id]}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{new Date(b.created_at).toLocaleDateString()}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                </Link>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
