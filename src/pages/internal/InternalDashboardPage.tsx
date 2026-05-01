import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  Users,
  FileText,
  Clock,
  CheckCircle,
  ArrowRight,
  TrendingUp,
  Shield
} from 'lucide-react';

interface DashboardStats {
  totalBorrowers: number;
  pendingReview: number;
  awaitingDocs: number;
  approved: number;
  pendingIdVerification: number;
  scenariosUnderReview: number;
}

interface RecentBorrower {
  id: string;
  borrower_name: string;
  lifecycle_stage: string;
  credit_score: number | null;
  updated_at: string;
}

export function InternalDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalBorrowers: 0,
    pendingReview: 0,
    awaitingDocs: 0,
    approved: 0,
    pendingIdVerification: 0,
    scenariosUnderReview: 0
  });
  const [recentBorrowers, setRecentBorrowers] = useState<RecentBorrower[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    try {
      const [
        totalRes,
        pendingRes,
        awaitingDocsRes,
        approvedRes,
        idVerifyRes,
        scenariosRes,
        recentRes
      ] = await Promise.all([
        supabase.from('borrowers').select('id', { count: 'exact', head: true }),
        supabase.from('borrowers').select('id', { count: 'exact', head: true }).eq('lifecycle_stage', 'documents_uploaded'),
        supabase.from('borrowers').select('id', { count: 'exact', head: true }).eq('lifecycle_stage', 'loan_type_selected'),
        supabase.from('borrowers').select('id', { count: 'exact', head: true }).eq('lifecycle_stage', 'pre_approved'),
        supabase.from('borrowers').select('id', { count: 'exact', head: true }).eq('id_document_verified', false),
        supabase.from('borrowers').select('id', { count: 'exact', head: true }).eq('lifecycle_stage', 'application_submitted'),
        supabase.from('borrowers')
          .select('id, borrower_name, lifecycle_stage, credit_score, updated_at')
          .order('updated_at', { ascending: false })
          .limit(5)
      ]);

      setStats({
        totalBorrowers: totalRes.count || 0,
        pendingReview: pendingRes.count || 0,
        awaitingDocs: awaitingDocsRes.count || 0,
        approved: approvedRes.count || 0,
        pendingIdVerification: idVerifyRes.count || 0,
        scenariosUnderReview: scenariosRes.count || 0
      });

      setRecentBorrowers(recentRes.data || []);
    } finally {
      setLoading(false);
    }
  }

  const getLifecycleBadge = (stage: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      profile_created: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Profile' },
      loan_type_selected: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Loan Type' },
      documents_uploaded: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Docs Uploaded' },
      liquidity_verified: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'Verified' },
      pre_approved: { bg: 'bg-teal-100', text: 'text-teal-700', label: 'Pre-Approved' },
      application_started: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'App Started' },
      application_submitted: { bg: 'bg-green-100', text: 'text-green-700', label: 'Submitted' }
    };
    const config = configs[stage] || configs.profile_created;
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Overview of borrower applications and underwriting queue</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Link
          to="/internal/borrowers"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-slate-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-slate-500" />
            <span className="text-sm text-gray-500">Total Borrowers</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.totalBorrowers}</p>
        </Link>

        <Link
          to="/internal/borrowers?stage=documents_uploaded"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-blue-500" />
            <span className="text-sm text-gray-500">Pending Review</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{stats.pendingReview}</p>
        </Link>

        <Link
          to="/internal/borrowers?stage=loan_type_selected"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-orange-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-orange-500" />
            <span className="text-sm text-gray-500">Awaiting Docs</span>
          </div>
          <p className="text-2xl font-bold text-orange-600">{stats.awaitingDocs}</p>
        </Link>

        <Link
          to="/internal/borrowers?stage=pre_approved"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-green-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm text-gray-500">Pre-Approved</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
        </Link>

        <Link
          to="/internal/borrowers?id_pending=true"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-amber-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-5 h-5 text-amber-500" />
            <span className="text-sm text-gray-500">ID Pending</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{stats.pendingIdVerification}</p>
        </Link>

        <Link
          to="/internal/borrowers?stage=application_submitted"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-teal-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-teal-500" />
            <span className="text-sm text-gray-500">Apps Submitted</span>
          </div>
          <p className="text-2xl font-bold text-teal-600">{stats.scenariosUnderReview}</p>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Borrowers</h2>
            <Link
              to="/internal/borrowers"
              className="text-sm text-teal-600 font-medium flex items-center gap-1 hover:text-teal-700"
            >
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          {recentBorrowers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No borrowers yet
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentBorrowers.map(borrower => (
                <Link
                  key={borrower.id}
                  to={`/internal/my-borrowers/${borrower.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{borrower.borrower_name}</p>
                    <p className="text-sm text-gray-500">
                      {borrower.credit_score ? `Credit: ${borrower.credit_score}` : 'No credit score'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {getLifecycleBadge(borrower.lifecycle_stage || 'profile_created')}
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Quick Actions</h2>
          </div>
          <div className="p-4 space-y-3">
            <Link
              to="/internal/borrowers?status=under_review"
              className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">Review Pending Applications</p>
                <p className="text-sm text-gray-500">{stats.pendingReview} awaiting review</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </Link>

            <Link
              to="/internal/borrowers?id_pending=true"
              className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-colors"
            >
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">Verify Identity Documents</p>
                <p className="text-sm text-gray-500">{stats.pendingIdVerification} pending verification</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </Link>

            <Link
              to="/internal/placerbot"
              className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-teal-300 hover:bg-teal-50 transition-colors"
            >
              <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-teal-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">Run PlacerBot Analysis</p>
                <p className="text-sm text-gray-500">Analyze borrower placement options</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
