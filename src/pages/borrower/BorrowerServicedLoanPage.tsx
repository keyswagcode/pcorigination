import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, Banknote, ShieldCheck, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getServicedLoan, getSchedule, getPayments, getActiveAchAuth } from '../../services/servicingService';
import { generatePayoffStatementPdf } from '../../lib/payoffStatementGenerator';
import { perDiemInterest } from '../../lib/amortization';
import type { ServicedLoan, ServicedLoanScheduleRow, ServicedLoanPayment, ServicedLoanAchAuthorization } from '../../shared/types';

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

export function BorrowerServicedLoanPage() {
  const { loanId } = useParams<{ loanId: string }>();
  const { user } = useAuth();
  const [loan, setLoan] = useState<ServicedLoan | null>(null);
  const [orgName, setOrgName] = useState<string>('Key Real Estate Capital');
  const [schedule, setSchedule] = useState<ServicedLoanScheduleRow[]>([]);
  const [payments, setPayments] = useState<ServicedLoanPayment[]>([]);
  const [achAuth, setAchAuth] = useState<ServicedLoanAchAuthorization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<'amortization' | 'history' | 'documents'>('amortization');

  useEffect(() => {
    if (!loanId) return;
    (async () => {
      const l = await getServicedLoan(loanId);
      setLoan(l);
      if (l) {
        const [s, p, a] = await Promise.all([getSchedule(loanId), getPayments(loanId), getActiveAchAuth(loanId)]);
        setSchedule(s);
        setPayments(p);
        setAchAuth(a);
        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', l.organization_id)
          .maybeSingle();
        if (org?.name) setOrgName(org.name);
      }
      setIsLoading(false);
    })();
  }, [loanId]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }
  if (!loan) {
    return <div className="text-center py-16"><p className="text-gray-500">Loan not found.</p></div>;
  }

  const nextDueRow = schedule.find(r => r.status === 'scheduled');
  const perDiem = perDiemInterest(loan.current_principal, loan.interest_rate);

  const handlePayoff = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const good = new Date(); good.setDate(good.getDate() + 30);
    await generatePayoffStatementPdf({
      orgName,
      orgLogoUrl: null,
      borrowerName: user?.email || 'Borrower',
      loanNumber: loan.loan_number,
      propertyAddress: [loan.property_address, loan.property_city, loan.property_state, loan.property_zip].filter(Boolean).join(', '),
      currentPrincipal: loan.current_principal,
      interestRate: loan.interest_rate,
      lastPaidThroughDate: today,
      payoffDate: good.toISOString().slice(0, 10),
      escrowBalance: loan.escrow_balance,
      unpaidLateFees: 0,
      recordingFee: 35,
      remitToName: orgName,
      remitToAddress: 'San Diego, CA 92101',
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/application/servicing" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Your Loan</h1>
          <p className="text-sm text-gray-500 mt-1">Serviced by {orgName} · Loan #{loan.loan_number}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wide text-gray-500">Current Balance</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{fmtCurrency(loan.current_principal)}</p>
          <p className="text-xs text-gray-500 mt-2">Interest accrues at {fmtCurrency(perDiem)}/day</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wide text-gray-500">Next Payment</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{nextDueRow ? fmtCurrency(nextDueRow.scheduled_total) : '—'}</p>
          <p className="text-xs text-gray-500 mt-2">Due {nextDueRow?.due_date || '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wide text-gray-500">Auto-Pay</p>
          {achAuth ? (
            <>
              <p className="text-base font-semibold text-teal-700 mt-1 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> Active
              </p>
              <p className="text-xs text-gray-500 mt-2">{achAuth.bank_name || 'Bank'} ••••{achAuth.account_mask}</p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-amber-700 mt-1 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Not set up
              </p>
              <button
                onClick={() => alert('Plaid Link setup is not yet enabled in production. Coming soon.')}
                className="mt-2 text-xs text-teal-700 underline hover:text-teal-900"
              >
                Set up Auto-Pay
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={handlePayoff}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
        >
          <FileText className="w-4 h-4" /> Request Payoff Statement
        </button>
      </div>

      <div className="border-b border-gray-200 flex gap-1">
        {(['amortization', 'history', 'documents'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'amortization' ? 'Amortization' : t === 'history' ? 'Payment History' : 'Documents'}
          </button>
        ))}
      </div>

      {tab === 'amortization' && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Due</th>
                <th className="text-right px-3 py-2">Principal</th>
                <th className="text-right px-3 py-2">Interest</th>
                <th className="text-right px-3 py-2">Escrow</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Balance</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {schedule.map(r => (
                <tr key={r.id} className={r.status === 'paid' ? 'opacity-60' : ''}>
                  <td className="px-3 py-2 text-gray-700">{r.payment_number}</td>
                  <td className="px-3 py-2 text-gray-700">{r.due_date}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.scheduled_principal)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.scheduled_interest)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.scheduled_escrow)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(r.scheduled_total)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmtCurrency(r.ending_balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      r.status === 'paid' ? 'bg-teal-100 text-teal-800' :
                      r.status === 'late' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'history' && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          {payments.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Banknote className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500">No payments yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">Principal</th>
                  <th className="text-right px-3 py-2">Interest</th>
                  <th className="text-right px-3 py-2">Escrow</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-gray-700">{new Date(p.initiated_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtCurrency(p.amount)}</td>
                    <td className="px-3 py-2 text-right">{fmtCurrency(p.principal_applied)}</td>
                    <td className="px-3 py-2 text-right">{fmtCurrency(p.interest_applied)}</td>
                    <td className="px-3 py-2 text-right">{fmtCurrency(p.escrow_applied)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        p.status === 'posted' ? 'bg-teal-100 text-teal-800' :
                        p.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="border border-gray-200 rounded-xl bg-white p-8 text-center text-gray-500">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p>Payoff statements and year-end 1098s appear here.</p>
          <p className="text-xs mt-2">Use the "Request Payoff Statement" button above to download one now.</p>
        </div>
      )}
    </div>
  );
}
