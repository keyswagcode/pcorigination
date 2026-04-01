import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle2, Trash2
} from 'lucide-react';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

const LOAN_TYPE_LABELS: Record<string, string> = { dscr: 'DSCR', fix_flip: 'Fix & Flip', bridge: 'Bridge' };
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-600' },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  declined: { label: 'Declined', color: 'bg-red-100 text-red-700' },
  under_review: { label: 'Under Review', color: 'bg-amber-100 text-amber-700' },
};

export function BorrowerLoanEditPage() {
  const { loanId } = useParams<{ loanId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const [loanType, setLoanType] = useState('');
  const [loanPurpose, setLoanPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyZip, setPropertyZip] = useState('');
  const [propertyValue, setPropertyValue] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [ltv, setLtv] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [rehabBudget, setRehabBudget] = useState('');
  const [afterRepairValue, setAfterRepairValue] = useState('');
  const [refinanceType, setRefinanceType] = useState('');
  const [propertyType, setPropertyType] = useState('');

  const PROPERTY_TYPES = [
    { value: 'sfh', label: 'SFH' },
    { value: 'condo', label: 'Condo' },
    { value: 'townhome', label: 'Townhome' },
    { value: '2-4_unit', label: '2-4 Unit' },
    { value: '5-8_unit', label: '5-8 Unit' },
  ];

  useEffect(() => {
    async function loadLoan() {
      if (!loanId || !user) return;

      const { data } = await supabase
        .from('loan_scenarios')
        .select('*')
        .eq('id', loanId)
        .maybeSingle();

      if (!data) { setIsLoading(false); return; }

      setLoanType(data.loan_type || '');
      setLoanPurpose(data.loan_purpose || '');
      setStatus(data.status || '');
      setPropertyAddress(data.property_address || '');
      setPropertyCity(data.property_city || '');
      setPropertyState(data.property_state || '');
      setPropertyZip(data.property_zip || '');
      setPropertyValue(data.estimated_value ? data.estimated_value.toLocaleString() : '');
      setLoanAmount(data.loan_amount ? data.loan_amount.toLocaleString() : '');
      setLtv(data.ltv ? String(data.ltv) : '');
      setScenarioName(data.scenario_name || '');
      setRehabBudget(data.rehab_budget ? data.rehab_budget.toLocaleString() : '');
      setAfterRepairValue(data.after_repair_value ? data.after_repair_value.toLocaleString() : '');
      setRefinanceType(data.refinance_type || '');
      setPropertyType(data.property_type || '');
      setCanEdit(data.status === 'draft' || data.status === 'submitted');
      setIsLoading(false);
    }
    loadLoan();
  }, [loanId, user]);

  const formatCurrency = (value: string) => {
    const num = value.replace(/\D/g, '');
    return num ? parseInt(num).toLocaleString() : '';
  };

  const parseCurrency = (value: string) => parseInt(value.replace(/\D/g, '')) || 0;

  const value = parseCurrency(propertyValue);
  const amount = parseCurrency(loanAmount);
  const calculatedLtv = value > 0 ? ((amount / value) * 100).toFixed(1) : '';

  // Fix & Flip / Bridge constraints
  const isFixFlipType = loanType === 'fix_flip' || loanType === 'bridge';
  const arvValue = parseCurrency(afterRepairValue);
  const rehabValue = parseCurrency(rehabBudget);
  const maxByArv = arvValue > 0 ? arvValue * 0.75 : Infinity;
  const maxByPurchaseRehab = (value > 0 || rehabValue > 0) ? (value * 0.9) + (rehabValue * 1.0) : Infinity;
  const fixFlipMaxLoan = isFixFlipType ? Math.min(maxByArv, maxByPurchaseRehab) : Infinity;
  const loanExceedsMax = isFixFlipType && amount > 0 && fixFlipMaxLoan !== Infinity && amount > fixFlipMaxLoan;

  const handleSave = async () => {
    if (!loanId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const ltvNum = value > 0 ? (amount / value) * 100 : parseFloat(ltv) || 0;
      const isRefi = loanPurpose === 'refinance';

      const isFixFlip = loanType === 'fix_flip' || loanType === 'bridge';
      const { error: updateError } = await supabase.from('loan_scenarios').update({
        scenario_name: scenarioName || `${isRefi ? 'Refinance' : 'Purchase'} - ${propertyAddress || 'Property'}`,
        loan_type: loanType,
        property_address: propertyAddress,
        property_city: propertyCity,
        property_state: propertyState,
        property_zip: propertyZip,
        purchase_price: isRefi ? null : value,
        estimated_value: value,
        loan_amount: amount,
        ltv: Math.round(ltvNum * 100) / 100,
        rehab_budget: isFixFlip && rehabBudget ? parseCurrency(rehabBudget) : null,
        after_repair_value: isFixFlip && afterRepairValue ? parseCurrency(afterRepairValue) : null,
        refinance_type: loanPurpose === 'refinance' ? refinanceType || null : null,
        property_type: propertyType || null,
      }).eq('id', loanId);

      if (updateError) throw updateError;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!loanId || !confirm('Are you sure you want to delete this loan?')) return;

    await supabase.from('loan_scenarios').delete().eq('id', loanId);
    navigate('/application/loans');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  if (!loanType) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 text-center">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Loan Not Found</h2>
        <button onClick={() => navigate('/application/loans')} className="text-teal-600 hover:underline text-sm">Back to My Loans</button>
      </div>
    );
  }

  const statusConfig = STATUS_LABELS[status] || STATUS_LABELS.draft;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <button onClick={() => navigate('/application/loans')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to My Loans
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{scenarioName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">{LOAN_TYPE_LABELS[loanType] || loanType} &middot; {loanPurpose}</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.color}`}>{statusConfig.label}</span>
          </div>
        </div>
        {canEdit && (
          <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
          This loan has been {status} and can no longer be edited.
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="space-y-5">
        {/* Loan Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Loan Name</label>
          <input type="text" value={scenarioName} onChange={e => setScenarioName(e.target.value)} disabled={!canEdit}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" />
        </div>

        {/* Refinance Type */}
        {loanPurpose === 'refinance' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Refinance Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => canEdit && setRefinanceType('rate_term')} disabled={!canEdit}
                className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${refinanceType === 'rate_term' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-700'} ${!canEdit ? 'opacity-60' : 'hover:border-gray-300'}`}>
                Rate & Term
              </button>
              <button type="button" onClick={() => canEdit && setRefinanceType('cash_out')} disabled={!canEdit}
                className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${refinanceType === 'cash_out' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-700'} ${!canEdit ? 'opacity-60' : 'hover:border-gray-300'}`}>
                Cash-Out
              </button>
            </div>
          </div>
        )}

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Property Address</label>
          <input type="text" value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)} disabled={!canEdit}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="123 Main St" />
          <div className="grid grid-cols-6 gap-2 mt-2">
            <input type="text" value={propertyCity} onChange={e => setPropertyCity(e.target.value)} disabled={!canEdit}
              className="col-span-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="City" />
            <select value={propertyState} onChange={e => setPropertyState(e.target.value)} disabled={!canEdit}
              className="col-span-1 px-2 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600">
              <option value="">ST</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="text" value={propertyZip} onChange={e => setPropertyZip(e.target.value.replace(/\D/g, '').slice(0, 5))} disabled={!canEdit}
              className="col-span-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Zip" />
          </div>
        </div>

        {/* Property Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Property Type</label>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPES.map(pt => (
              <button key={pt.value} type="button" onClick={() => canEdit && setPropertyType(pt.value)} disabled={!canEdit}
                className={`px-4 py-2 border-2 rounded-lg text-sm font-medium transition-all ${
                  propertyType === pt.value ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600'
                } ${!canEdit ? 'opacity-60' : 'hover:border-gray-300'}`}>
                {pt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Value */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {loanPurpose === 'refinance' ? 'As-Is Value' : 'Purchase Price'}
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input type="text" value={propertyValue} onChange={e => setPropertyValue(formatCurrency(e.target.value))} disabled={!canEdit}
              className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" />
          </div>
        </div>

        {/* LTV + Loan Amount */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">LTV %</label>
            <input type="text" value={calculatedLtv || ltv} disabled
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-500 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Loan Amount</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input type="text" value={loanAmount} onChange={e => setLoanAmount(formatCurrency(e.target.value))} disabled={!canEdit}
                className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" />
            </div>
          </div>
        </div>

        {/* Rehab Budget + ARV (Fix & Flip / Bridge only) */}
        {(loanType === 'fix_flip' || loanType === 'bridge') && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rehab Budget</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input type="text" value={rehabBudget} onChange={e => setRehabBudget(formatCurrency(e.target.value))} disabled={!canEdit}
                    className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="75,000" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">After Repair Value (ARV)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input type="text" value={afterRepairValue} onChange={e => setAfterRepairValue(formatCurrency(e.target.value))} disabled={!canEdit}
                    className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="500,000" />
                </div>
              </div>
            </div>

            {(arvValue > 0 || rehabValue > 0) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1">
                {arvValue > 0 && (
                  <p className="text-xs text-gray-600">Max loan (75% of ARV): <span className="font-medium">${Math.round(maxByArv).toLocaleString()}</span></p>
                )}
                {(value > 0 || rehabValue > 0) && (
                  <p className="text-xs text-gray-600">Max loan (90% purchase + 100% rehab): <span className="font-medium">${Math.round(maxByPurchaseRehab).toLocaleString()}</span></p>
                )}
                {fixFlipMaxLoan !== Infinity && (
                  <p className="text-xs font-medium text-gray-900">Maximum allowed: ${Math.round(fixFlipMaxLoan).toLocaleString()}</p>
                )}
              </div>
            )}
          </>
        )}

        {loanExceedsMax && (
          <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
            Loan amount exceeds the maximum of ${Math.round(fixFlipMaxLoan).toLocaleString()}. The total loan cannot exceed 75% of ARV or 90% of purchase price + 100% of rehab budget.
          </div>
        )}

        {/* Save */}
        {canEdit && (
          <div className="flex gap-3 pt-2">
            <button onClick={() => navigate('/application/loans')}
              className="px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loanExceedsMax}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
