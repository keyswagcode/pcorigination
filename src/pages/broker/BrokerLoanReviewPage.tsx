import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, CheckCircle2, XCircle, DollarSign, MapPin,
  User, Loader2, Building2, Home, X
} from 'lucide-react';
import { logAudit } from '../../services/auditService';
import { orderAppraisal, type AppraisalClassification } from '../../services/valoraAppraisalService';

interface LoanDetail {
  id: string;
  scenario_name: string;
  loan_type: string | null;
  loan_purpose: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  purchase_price: number | null;
  estimated_value: number | null;
  loan_amount: number | null;
  ltv: number | null;
  status: string;
  borrower_id: string;
}

interface BorrowerSummary {
  borrower_name: string;
  email: string | null;
  credit_score: number | null;
  borrower_status: string | null;
}

interface FinancialProfile {
  liquidity_estimate: number | null;
}

const DSCR_TASKS = [
  { title: 'Order Appraisal', description: 'Order property appraisal from approved AMC' },
  { title: 'Title Search', description: 'Order preliminary title report' },
  { title: 'Insurance Verification', description: 'Verify property insurance coverage meets requirements' },
  { title: 'Lease Agreement Review', description: 'Review current lease agreement and rental income' },
  { title: 'Rent Roll Verification', description: 'Verify rent roll and occupancy status' },
  { title: 'Final Underwriting Review', description: 'Complete final underwriting package review' },
];

const FIX_FLIP_TASKS = [
  { title: 'Order Appraisal (As-Is + ARV)', description: 'Order dual appraisal: as-is value and after-repair value' },
  { title: 'Title Search', description: 'Order preliminary title report' },
  { title: 'Insurance Verification', description: 'Verify builder risk and property insurance' },
  { title: 'Contractor Bids Review', description: 'Review contractor bids and qualifications' },
  { title: 'Draw Schedule Setup', description: 'Establish rehab draw schedule and inspection milestones' },
  { title: 'Rehab Budget Review', description: 'Detailed review of renovation budget and scope of work' },
  { title: 'Final Underwriting Review', description: 'Complete final underwriting package review' },
];

const LOAN_TYPE_LABELS: Record<string, string> = { dscr: 'DSCR', fix_flip: 'Fix & Flip', bridge: 'Bridge' };

export function BrokerLoanReviewPage() {
  const { loanId } = useParams<{ loanId: string }>();
  const { user, userAccount } = useAuth();
  const navigate = useNavigate();
  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [borrower, setBorrower] = useState<BorrowerSummary | null>(null);
  const [financial, setFinancial] = useState<FinancialProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [declineNotes, setDeclineNotes] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [showAppraisalModal, setShowAppraisalModal] = useState(false);
  const [orderingAppraisal, setOrderingAppraisal] = useState(false);
  const [appraisalError, setAppraisalError] = useState<string | null>(null);
  const [appraisalResult, setAppraisalResult] = useState<{ classification: AppraisalClassification; orderId: string | null } | null>(null);

  const valoraConnected = !!userAccount?.valora_username;

  const handleOrderAppraisal = async () => {
    if (!loan) return;
    setOrderingAppraisal(true);
    setAppraisalError(null);
    setAppraisalResult(null);
    try {
      const res = await orderAppraisal(loan.id);
      setAppraisalResult({ classification: res.classification, orderId: res.order_id });
    } catch (err) {
      setAppraisalError(err instanceof Error ? err.message : 'Failed to order appraisal');
    } finally {
      setOrderingAppraisal(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      if (!loanId) return;
      const { data: loanData } = await supabase
        .from('loan_scenarios')
        .select('*')
        .eq('id', loanId)
        .maybeSingle();
      if (!loanData) { setIsLoading(false); return; }
      setLoan(loanData);

      const [bRes, fRes] = await Promise.all([
        supabase.from('borrowers').select('borrower_name, email, credit_score, borrower_status').eq('id', loanData.borrower_id).maybeSingle(),
        supabase.from('borrower_financial_profiles').select('liquidity_estimate').eq('borrower_id', loanData.borrower_id).maybeSingle(),
      ]);
      setBorrower(bRes.data);
      setFinancial(fRes.data);
      setIsLoading(false);
    }
    loadData();
  }, [loanId]);

  const handleApprove = async () => {
    if (!loan || !user) return;
    setProcessing(true);

    // Update loan status
    await supabase.from('loan_scenarios').update({ status: 'approved' }).eq('id', loan.id);
    await logAudit({ borrowerId: loan.borrower_id, loanScenarioId: loan.id, userId: user.id, action: 'approved', entityType: 'loan', entityId: loan.id, fieldName: 'status', oldValue: 'submitted', newValue: 'approved' });

    // Create task checklist based on loan type
    const tasks = (loan.loan_type === 'fix_flip' || loan.loan_type === 'bridge') ? FIX_FLIP_TASKS : DSCR_TASKS;
    const taskInserts = tasks.map((task, i) => ({
      loan_scenario_id: loan.id,
      borrower_id: loan.borrower_id,
      title: task.title,
      description: task.description,
      status: 'pending',
      sort_order: i,
    }));
    await supabase.from('loan_tasks').insert(taskInserts);

    // Log activity
    await supabase.from('borrower_activity_log').insert({
      borrower_id: loan.borrower_id,
      user_id: user.id,
      event_type: 'loan_approved',
      title: `Loan approved: ${loan.scenario_name}`,
      details: `Loan amount: $${loan.loan_amount?.toLocaleString() || 0}. ${tasks.length} tasks created.`,
    });

    navigate(`/internal/my-borrowers/${loan.borrower_id}`);
  };

  const handleDecline = async () => {
    if (!loan || !user) return;
    setProcessing(true);

    await supabase.from('loan_scenarios').update({ status: 'declined' }).eq('id', loan.id);
    await logAudit({ borrowerId: loan.borrower_id, loanScenarioId: loan.id, userId: user.id, action: 'declined', entityType: 'loan', entityId: loan.id, fieldName: 'status', oldValue: 'submitted', newValue: 'declined', metadata: { reason: declineNotes } });

    await supabase.from('borrower_activity_log').insert({
      borrower_id: loan.borrower_id,
      user_id: user.id,
      event_type: 'loan_declined',
      title: `Loan declined: ${loan.scenario_name}`,
      details: declineNotes || 'No reason provided',
    });

    navigate(`/internal/my-borrowers/${loan.borrower_id}`);
  };

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  if (!loan) return <div className="text-center py-20"><p className="text-gray-500">Loan not found</p></div>;

  const alreadyReviewed = loan.status !== 'submitted';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to={`/internal/my-borrowers/${loan.borrower_id}`} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> Back to Borrower
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Loan Review</h1>
          <p className="text-gray-500 mt-1">{loan.scenario_name}</p>
        </div>
        <button
          onClick={() => { setAppraisalError(null); setAppraisalResult(null); setShowAppraisalModal(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          title="Order appraisal from Valora AMC"
        >
          <Home className="w-4 h-4" /> Order Appraisal
        </button>
      </div>

      {alreadyReviewed && (
        <div className={`px-5 py-4 rounded-xl ${loan.status === 'approved' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <p className={`font-medium ${loan.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
            This loan has been {loan.status}.
          </p>
        </div>
      )}

      {/* Borrower Summary */}
      {borrower && (
        <div className="border border-gray-200 rounded-xl bg-white px-6 py-5">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-3">Borrower</h2>
          <div className="grid grid-cols-4 gap-4">
            <div><p className="text-xs text-gray-500">Name</p><p className="text-sm font-medium text-gray-900">{borrower.borrower_name}</p></div>
            <div><p className="text-xs text-gray-500">Email</p><p className="text-sm text-gray-900">{borrower.email}</p></div>
            <div><p className="text-xs text-gray-500">Credit Score</p><p className="text-sm font-medium text-gray-900">{borrower.credit_score || '—'}</p></div>
            <div><p className="text-xs text-gray-500">Verified Liquidity</p><p className="text-sm font-medium text-teal-700">{financial?.liquidity_estimate ? `$${financial.liquidity_estimate.toLocaleString()}` : '—'}</p></div>
          </div>
        </div>
      )}

      {/* Loan Details */}
      <div className="border border-gray-200 rounded-xl bg-white px-6 py-5">
        <h2 className="text-sm font-medium text-gray-500 uppercase mb-3">Loan Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-xs text-gray-500">Loan Type</p><p className="text-sm font-medium text-gray-900">{LOAN_TYPE_LABELS[loan.loan_type || ''] || loan.loan_type}</p></div>
          <div><p className="text-xs text-gray-500">Purpose</p><p className="text-sm font-medium text-gray-900 capitalize">{loan.loan_purpose}</p></div>
          <div><p className="text-xs text-gray-500">Loan Amount</p><p className="text-lg font-bold text-gray-900">${loan.loan_amount?.toLocaleString() || '—'}</p></div>
          <div><p className="text-xs text-gray-500">LTV</p><p className="text-sm font-medium text-gray-900">{loan.ltv ? `${loan.ltv.toFixed(1)}%` : '—'}</p></div>
          <div><p className="text-xs text-gray-500">{loan.loan_purpose === 'refinance' ? 'As-Is Value' : 'Purchase Price'}</p><p className="text-sm font-medium text-gray-900">${(loan.purchase_price || loan.estimated_value)?.toLocaleString() || '—'}</p></div>
          <div>
            <p className="text-xs text-gray-500">Property Address</p>
            <p className="text-sm text-gray-900">{[loan.property_address, loan.property_city, loan.property_state, loan.property_zip].filter(Boolean).join(', ') || '—'}</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {!alreadyReviewed && (
        <div className="border border-gray-200 rounded-xl bg-white px-6 py-5">
          {!showDeclineForm ? (
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Approve Loan
              </button>
              <button
                onClick={() => setShowDeclineForm(true)}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-red-200 text-red-700 font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-5 h-5" />
                Decline
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Reason for declining:</p>
              <textarea
                value={declineNotes}
                onChange={e => setDeclineNotes(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                rows={3}
                placeholder="Enter reason for declining this loan..."
              />
              <div className="flex gap-3">
                <button onClick={() => setShowDeclineForm(false)} className="px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button onClick={handleDecline} disabled={processing} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Confirm Decline
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Appraisal modal */}
      {showAppraisalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Order Appraisal — Valora AMC</h3>
                <p className="text-xs text-gray-500 mt-1">Loan info auto-fills the order. Review below before submitting.</p>
              </div>
              <button onClick={() => setShowAppraisalModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!valoraConnected && (
              <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-800">
                You haven't saved Valora credentials yet. <Link to="/internal/settings" className="underline font-medium">Add them in Settings</Link> before ordering.
              </div>
            )}

            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-gray-500">Loan Type / Purpose</span>
                <span className="text-gray-900 font-medium">
                  {(LOAN_TYPE_LABELS[loan.loan_type || ''] || loan.loan_type || '—')} · {loan.loan_purpose === 'refinance' ? 'Refinance' : 'Purchase'}
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-gray-500">Property</span>
                <span className="text-gray-900 text-right">
                  {[loan.property_address, loan.property_city, loan.property_state, loan.property_zip].filter(Boolean).join(', ') || '—'}
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-gray-500">{loan.loan_purpose === 'refinance' ? 'Estimated Value' : 'Purchase Price'}</span>
                <span className="text-gray-900 font-medium">
                  ${((loan.loan_purpose === 'refinance' ? loan.estimated_value : loan.purchase_price) || 0).toLocaleString()}
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-gray-500">Loan Amount</span>
                <span className="text-gray-900 font-medium">${(loan.loan_amount || 0).toLocaleString()}</span>
              </div>
              {borrower && (
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-gray-500">Borrower</span>
                  <span className="text-gray-900">{borrower.borrower_name}</span>
                </div>
              )}
            </div>

            {appraisalError && (
              <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{appraisalError}</div>
            )}

            {appraisalResult && (
              <div className="px-3 py-2 bg-teal-50 border border-teal-100 rounded-lg text-sm text-teal-800 space-y-1">
                <p className="font-medium">Order classified as <span className="font-mono">{appraisalResult.classification.productCode}</span></p>
                {appraisalResult.classification.needsArv && <p className="text-xs">Includes After-Repair Value (ARV)</p>}
                {appraisalResult.orderId && <p className="text-xs">Valora order id: {appraisalResult.orderId}</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAppraisalModal(false)}
                disabled={orderingAppraisal}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleOrderAppraisal}
                disabled={orderingAppraisal || !valoraConnected}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {orderingAppraisal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Home className="w-4 h-4" />}
                {orderingAppraisal ? 'Submitting…' : 'Submit Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
