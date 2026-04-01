import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  Building2, Plus, MapPin, DollarSign, Clock,
  CheckCircle2, XCircle, Loader2, ArrowRight
} from 'lucide-react';

interface LoanScenario {
  id: string;
  scenario_name: string;
  loan_type: string | null;
  loan_purpose: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  loan_amount: number | null;
  ltv: number | null;
  status: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-600', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700', icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  declined: { label: 'Declined', color: 'bg-red-100 text-red-700', icon: XCircle },
  matched: { label: 'Matched', color: 'bg-teal-100 text-teal-700', icon: CheckCircle2 },
  conditionally_approved: { label: 'Conditional', color: 'bg-amber-100 text-amber-700', icon: Clock },
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  dscr: 'DSCR',
  fix_flip: 'Fix & Flip',
  bridge: 'Bridge',
};

export function BorrowerLoansPage() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<LoanScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setBorrowerId] = useState<string | null>(null);

  useEffect(() => {
    async function loadLoans() {
      if (!user) return;
      const { data: borrower } = await supabase
        .from('borrowers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!borrower) { setIsLoading(false); return; }
      setBorrowerId(borrower.id);

      const { data } = await supabase
        .from('loan_scenarios')
        .select('id, scenario_name, loan_type, loan_purpose, property_address, property_city, property_state, loan_amount, ltv, status, created_at')
        .eq('borrower_id', borrower.id)
        .order('created_at', { ascending: false });
      setLoans(data || []);
      setIsLoading(false);
    }
    loadLoans();
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">My Loans</h1>
          <p className="text-gray-500 mt-1">Track your loan applications and their status.</p>
        </div>
        <Link
          to="/application/new-loan"
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Loan
        </Link>
      </div>

      {loans.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No loans yet</h2>
          <p className="text-gray-500 mb-6">Submit your first loan to get started.</p>
          <Link
            to="/application/new-loan"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Loan
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {loans.map(loan => {
            const config = STATUS_CONFIG[loan.status] || STATUS_CONFIG.draft;
            const StatusIcon = config.icon;

            return (
              <Link key={loan.id} to={`/application/loans/${loan.id}`} className="block border border-gray-200 rounded-xl bg-white px-5 py-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{loan.scenario_name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        {loan.property_address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {loan.property_city}, {loan.property_state}
                          </span>
                        )}
                        {loan.loan_type && (
                          <span>{LOAN_TYPE_LABELS[loan.loan_type] || loan.loan_type}</span>
                        )}
                        {loan.loan_purpose && (
                          <span className="capitalize">{loan.loan_purpose}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {loan.loan_amount && (
                      <div className="text-right hidden sm:block">
                        <span className="flex items-center gap-1 text-lg font-semibold text-gray-900">
                          <DollarSign className="w-4 h-4 text-gray-400" />
                          {loan.loan_amount.toLocaleString()}
                        </span>
                        {loan.ltv && (
                          <span className="text-xs text-gray-500">{loan.ltv.toFixed(1)}% LTV</span>
                        )}
                      </div>
                    )}
                    <span className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full ${config.color}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {config.label}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
