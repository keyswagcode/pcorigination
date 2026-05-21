import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Zap, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { getServicedLoan, getSchedule, getPayments, getActiveAchAuth } from '../../services/servicingService';
import { generatePayoffStatementPdf } from '../../lib/payoffStatementGenerator';
import { perDiemInterest } from '../../lib/amortization';
import type { ServicedLoan, ServicedLoanScheduleRow, ServicedLoanPayment, ServicedLoanAchAuthorization } from '../../shared/types';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

export function AdminServicedLoanDetailPage() {
  const { loanId } = useParams<{ loanId: string }>();
  const { userAccount } = useAuth();
  const { member, organization } = useTeam();

  const [loan, setLoan] = useState<ServicedLoan | null>(null);
  const [borrowerName, setBorrowerName] = useState<string>('');
  const [schedule, setSchedule] = useState<ServicedLoanScheduleRow[]>([]);
  const [payments, setPayments] = useState<ServicedLoanPayment[]>([]);
  const [achAuth, setAchAuth] = useState<ServicedLoanAchAuthorization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forceDebitId, setForceDebitId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<'schedule' | 'payments' | 'ach'>('schedule');

  const isAdminLike =
    userAccount?.user_role === 'admin' ||
    userAccount?.user_role === 'reviewer' ||
    member?.role === 'owner' ||
    member?.role === 'admin';

  const load = async () => {
    if (!loanId) return;
    const l = await getServicedLoan(loanId);
    setLoan(l);
    if (l) {
      const [s, p, a, br] = await Promise.all([
        getSchedule(loanId),
        getPayments(loanId),
        getActiveAchAuth(loanId),
        supabase.from('borrowers').select('borrower_name').eq('id', l.borrower_id).maybeSingle(),
      ]);
      setSchedule(s);
      setPayments(p);
      setAchAuth(a);
      setBorrowerName(br.data?.borrower_name || '');
    }
    setIsLoading(false);
  };

  useEffect(() => { load(); }, [loanId]);

  const handleForceDebit = async (scheduleId: string) => {
    if (!loan) return;
    setActionError(null);
    setActionSuccess(null);
    setForceDebitId(scheduleId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_URL}/servicing-debit-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mode: 'single', schedule_id: scheduleId, serviced_loan_id: loan.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Force debit failed');
      setActionSuccess(`Debit initiated. Transfer ID: ${data.transfer_id || '(pending)'}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Force debit failed');
    } finally {
      setForceDebitId(null);
    }
  };

  const handlePayoffStatement = async () => {
    if (!loan) return;
    const orgName = organization?.name || 'Key Real Estate Capital';
    // Fetch fresh servicing-remit fields off the org so this picks up
    // whatever admin saved in Settings → Servicing without needing a reload.
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
      borrowerName,
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
      remitToAddress: org?.servicing_remit_to_address || 'Please set in Settings → Servicing',
      remitToWireInstructions: org?.servicing_wire_instructions || undefined,
    });
  };

  if (!isAdminLike) return <div className="text-center py-20"><p className="text-gray-500">You don't have permission to view loan servicing.</p></div>;
  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  if (!loan) return <div className="text-center py-20"><p className="text-gray-500">Loan not found.</p></div>;

  const perDiem = perDiemInterest(loan.current_principal, loan.interest_rate);
  const paidCount = schedule.filter(r => r.status === 'paid').length;
  const totalPaid = payments.filter(p => p.status === 'posted').reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/internal/servicing" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
            Loan {loan.loan_number}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{borrowerName || 'Borrower'} · {loan.servicing_status.replace('_', ' ')}</p>
        </div>
        <button
          onClick={handlePayoffStatement}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
        >
          <FileText className="w-4 h-4" /> Payoff Statement
        </button>
      </div>

      {actionError && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="px-4 py-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {actionSuccess}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Current Balance" value={fmtCurrency(loan.current_principal)} />
        <Stat label="Next Due" value={loan.next_payment_due_date || '—'} />
        <Stat label="Interest Rate" value={`${(loan.interest_rate * 100).toFixed(3)}%`} />
        <Stat label="Per-Diem" value={fmtCurrency(perDiem)} />
        <Stat label="Original Principal" value={fmtCurrency(loan.original_principal)} />
        <Stat label="Maturity" value={loan.maturity_date} />
        <Stat label="Payments Posted" value={`${paidCount} / ${schedule.length}`} />
        <Stat label="Total Collected" value={fmtCurrency(totalPaid)} />
      </div>

      <div className="border-b border-gray-200 flex gap-1">
        {(['schedule', 'payments', 'ach'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'schedule' ? 'Amortization Schedule' : t === 'payments' ? 'Payment Ledger' : 'ACH Authorization'}
          </button>
        ))}
      </div>

      {tab === 'schedule' && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Due</th>
                <th className="text-right px-3 py-2 font-medium">Principal</th>
                <th className="text-right px-3 py-2 font-medium">Interest</th>
                <th className="text-right px-3 py-2 font-medium">Escrow</th>
                <th className="text-right px-3 py-2 font-medium">Total</th>
                <th className="text-right px-3 py-2 font-medium">Balance</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
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
                      r.status === 'partial' ? 'bg-amber-100 text-amber-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'scheduled' && (
                      <button onClick={() => handleForceDebit(r.id)} disabled={!!forceDebitId}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-purple-700 bg-purple-50 rounded hover:bg-purple-100 disabled:opacity-50">
                        {forceDebitId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        Force-debit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          {payments.length === 0 ? (
            <p className="px-4 py-12 text-center text-gray-500">No payments collected yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Initiated</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">P</th>
                  <th className="text-right px-3 py-2">I</th>
                  <th className="text-right px-3 py-2">E</th>
                  <th className="text-left px-3 py-2">Method</th>
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
                    <td className="px-3 py-2 text-gray-700">{p.payment_method}</td>
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

      {tab === 'ach' && (
        <div className="border border-gray-200 rounded-xl bg-white p-6">
          {achAuth ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-900">
                <span className="font-medium">{achAuth.bank_name || 'Bank'}</span> ••••{achAuth.account_mask}
              </p>
              <p className="text-xs text-gray-500">{achAuth.account_holder_name || '—'}</p>
              <p className="text-xs text-gray-500">Authorized {new Date(achAuth.authorized_at).toLocaleDateString()}</p>
              {achAuth.last_used_at && <p className="text-xs text-gray-500">Last used {new Date(achAuth.last_used_at).toLocaleDateString()}</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No active ACH authorization. Borrower needs to link a bank account via the borrower portal.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
