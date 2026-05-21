import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Loader2, Banknote, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { ServicedLoan } from '../../shared/types';

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

export function BorrowerServicingPage() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<ServicedLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Find the borrower row for this user, then list serviced loans
      const { data: b } = await supabase
        .from('borrowers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!b) { setIsLoading(false); return; }
      const { data } = await supabase
        .from('serviced_loans')
        .select('*')
        .eq('borrower_id', b.id)
        .order('created_at', { ascending: false });
      setLoans((data || []) as ServicedLoan[]);
      setIsLoading(false);
    })();
  }, [user]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  if (loans.length === 0) {
    // No serviced loans — nav shouldn't have shown the link, but guard anyway
    return (
      <div className="text-center py-16">
        <Banknote className="w-10 h-10 text-gray-300 mx-auto mb-2" />
        <p className="text-gray-500">No serviced loans yet.</p>
      </div>
    );
  }

  if (loans.length === 1) {
    return <Navigate to={`/application/servicing/${loans[0].id}`} replace />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Your Loans</h1>
        <p className="text-sm text-gray-500 mt-1">{loans.length} active loans serviced through us.</p>
      </div>
      <div className="space-y-3">
        {loans.map(l => (
          <Link
            key={l.id}
            to={`/application/servicing/${l.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-teal-400 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Loan #{l.loan_number}</p>
                <p className="text-xs text-gray-500 mt-0.5">{l.property_address || 'No address on file'}</p>
                <p className="text-xs text-gray-500 mt-1">Balance: <span className="font-medium text-gray-900">{fmtCurrency(l.current_principal)}</span> · Next due: {l.next_payment_due_date || '—'}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
