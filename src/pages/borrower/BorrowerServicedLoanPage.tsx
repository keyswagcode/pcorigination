import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, Banknote, ShieldCheck, AlertCircle, DollarSign, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getServicedLoan, getSchedule, getPayments, getActiveAchAuth } from '../../services/servicingService';
import { generatePayoffStatementPdf } from '../../lib/payoffStatementGenerator';
import { perDiemInterest } from '../../lib/amortization';
import type { ServicedLoan, ServicedLoanScheduleRow, ServicedLoanPayment, ServicedLoanAchAuthorization } from '../../shared/types';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

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
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<string | null>(null);

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

  const handleOneTimePay = async () => {
    if (!loan) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt < 1) { setPayError('Enter an amount of at least $1.'); return; }
    setSubmittingPay(true);
    setPayError(null);
    setPaySuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const res = await fetch(`${FUNCTIONS_URL}/servicing-debit-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mode: 'borrower_one_time', serviced_loan_id: loan.id, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Payment failed');
      setPaySuccess(`Payment of $${amt.toFixed(2)} initiated. It typically posts to your loan within 1–3 business days.`);
      setPayAmount('');
      // Refresh payment history
      const p = await getPayments(loan.id);
      setPayments(p);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setSubmittingPay(false);
    }
  };

  const handlePayoff = async () => {
    if (!loan) return;
    const { data: org } = await supabase
      .from('organizations')
      .select('name, servicing_remit_to_name, servicing_remit_to_address, servicing_wire_instructions')
      .eq('id', loan.organization_id)
      .maybeSingle();
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
      remitToName: org?.servicing_remit_to_name || orgName,
      remitToAddress: org?.servicing_remit_to_address || 'Contact your servicer for remit-to info',
      remitToWireInstructions: org?.servicing_wire_instructions || undefined,
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

      {loan.servicing_status === 'delinquent' && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Your loan is past due.</p>
            <p className="text-xs mt-1">A late fee has been added to your next scheduled payment. Make a payment now or contact us to discuss loss-mitigation options.</p>
          </div>
        </div>
      )}

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
          onClick={() => { setShowPayModal(true); setPayError(null); setPaySuccess(null); }}
          disabled={!achAuth}
          title={achAuth ? 'Make a one-time payment via your linked bank' : 'Set up Auto-Pay first to link a bank account'}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <DollarSign className="w-4 h-4" /> Make a Payment
        </button>
        <button
          onClick={handlePayoff}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
        >
          <FileText className="w-4 h-4" /> Request Payoff Statement
        </button>
      </div>

      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Make a Payment</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Debits from {achAuth?.bank_name || 'your linked bank'} •••• {achAuth?.account_mask || '----'}. One-time payments apply as a principal curtailment.
                </p>
              </div>
              <button onClick={() => setShowPayModal(false)} disabled={submittingPay} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {paySuccess && (
              <div className="px-3 py-2 bg-teal-50 border border-teal-100 rounded-lg text-sm text-teal-800">{paySuccess}</div>
            )}
            {payError && (
              <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">{payError}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input
                type="number"
                min={1}
                step={0.01}
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                disabled={submittingPay}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-50"
                placeholder="2500.00"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Any amount from $1 to $100,000.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowPayModal(false)}
                disabled={submittingPay}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleOneTimePay}
                disabled={submittingPay || !payAmount}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {submittingPay ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                {submittingPay ? 'Submitting…' : 'Submit Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

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
