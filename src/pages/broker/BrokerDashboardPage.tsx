import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Users, FileText, CheckCircle2, Clock, AlertCircle,
  DollarSign, Loader2, Copy, Check, ArrowRight
} from 'lucide-react';

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
  { key: 'documents_uploaded', label: 'Docs Uploaded' },
  { key: 'liquidity_verified', label: 'Liquidity Verified' },
  { key: 'pre_approved', label: 'Pre-Approved' },
  { key: 'application_submitted', label: 'Loan Submitted' },
];

export function BrokerDashboardPage() {
  const { user, userAccount } = useAuth();
  const [borrowers, setBorrowers] = useState<BorrowerSummary[]>([]);
  const [pendingLoans, setPendingLoans] = useState<LoanPending[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!user) return;

      // Fetch borrowers for this broker (scoped by RLS)
      const { data: borrowerData } = await supabase
        .from('borrowers')
        .select('id, borrower_name, email, credit_score, lifecycle_stage, borrower_status, created_at')
        .eq('broker_id', user.id)
        .order('created_at', { ascending: false });
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
  }, [user]);

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

      {/* Pipeline Kanban */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Pipeline</h2>
        <div className="grid grid-cols-5 gap-3">
          {PIPELINE_STAGES.map(stage => {
            const count = pipelineCounts[stage.key];
            const stageBorrowers = borrowers.filter(b => (b.lifecycle_stage || 'profile_created') === stage.key);

            return (
              <div key={stage.key} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{stage.label}</span>
                  <span className="text-sm font-bold text-gray-900">{count}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[100px] max-h-[300px] overflow-y-auto">
                  {stageBorrowers.map(b => (
                    <Link
                      key={b.id}
                      to={`/internal/my-borrowers/${b.id}`}
                      className="block p-3 bg-gray-50 hover:bg-teal-50 rounded-lg transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900 truncate">{b.borrower_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{b.credit_score ? `${b.credit_score} CS` : 'No CS'}</p>
                    </Link>
                  ))}
                  {stageBorrowers.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">None</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Loans Awaiting Review */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Loans Awaiting Review</h2>
          <span className="text-sm text-gray-500">{pendingLoans.length} pending</span>
        </div>
        {pendingLoans.length === 0 ? (
          <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No loans awaiting review</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingLoans.map(loan => (
              <Link
                key={loan.id}
                to={`/internal/loans/${loan.id}/review`}
                className="flex items-center justify-between px-5 py-4 border border-gray-200 rounded-xl bg-white hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{loan.scenario_name}</p>
                    <p className="text-sm text-gray-500">{loan.borrower_name} &middot; {loan.loan_type?.toUpperCase()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {loan.loan_amount && (
                    <span className="text-lg font-semibold text-gray-900">${loan.loan_amount.toLocaleString()}</span>
                  )}
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="border border-gray-200 rounded-xl bg-white px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-500">Total Borrowers</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{borrowers.length}</p>
        </div>
        <div className="border border-gray-200 rounded-xl bg-white px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-gray-500">Pending Review</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{pendingLoans.length}</p>
        </div>
        <div className="border border-gray-200 rounded-xl bg-white px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
            <span className="text-sm text-gray-500">Pre-Approved</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{borrowers.filter(b => b.lifecycle_stage === 'pre_approved').length}</p>
        </div>
        <div className="border border-gray-200 rounded-xl bg-white px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-gray-500">Docs Uploaded</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{borrowers.filter(b => b.lifecycle_stage === 'documents_uploaded').length}</p>
        </div>
      </div>
    </div>
  );
}
