import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, ArrowRight, Home, RefreshCw, DollarSign, Loader2, AlertCircle,
  Building2, Hammer, Landmark
} from 'lucide-react';

type LoanPurpose = 'purchase' | 'refinance' | null;
type LoanType = 'dscr' | 'fix_flip' | 'bridge' | null;

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

const LOAN_TYPES = [
  { key: 'dscr' as const, label: 'DSCR', description: 'Rental / investment property', icon: Landmark },
  { key: 'fix_flip' as const, label: 'Fix & Flip', description: 'Rehab and resell', icon: Hammer },
  { key: 'bridge' as const, label: 'Bridge', description: 'Short-term bridge financing', icon: Building2 },
];

export function NewLoanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [hasLiquidity, setHasLiquidity] = useState(false);
  const [loanPurpose, setLoanPurpose] = useState<LoanPurpose>(null);
  const [loanType, setLoanType] = useState<LoanType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [maxDscr, setMaxDscr] = useState(0);
  const [maxFixFlip, setMaxFixFlip] = useState(0);

  // Shared fields
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyZip, setPropertyZip] = useState('');
  const [propertyValue, setPropertyValue] = useState('');
  const [desiredLoanAmount, setDesiredLoanAmount] = useState('');
  const [desiredLtv, setDesiredLtv] = useState('');
  const [rehabBudget, setRehabBudget] = useState('');
  const [afterRepairValue, setAfterRepairValue] = useState('');
  const [refinanceType, setRefinanceType] = useState<'rate_term' | 'cash_out' | ''>('');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const { data: borrower } = await supabase
        .from('borrowers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!borrower) return;
      setBorrowerId(borrower.id);

      const { data: preApprovals } = await supabase
        .from('pre_approvals')
        .select('prequalified_amount, summary, loan_type')
        .eq('borrower_id', borrower.id)
        .eq('status', 'approved');

      if (preApprovals && preApprovals.length > 0) {
        setHasLiquidity(true);
        for (const pa of preApprovals) {
          if (pa.loan_type === 'dscr' || pa.summary?.includes('DSCR')) setMaxDscr(pa.prequalified_amount || 0);
          if (pa.loan_type === 'fix_flip' || pa.loan_type === 'bridge' || pa.summary?.includes('Fix')) setMaxFixFlip(pa.prequalified_amount || 0);
        }
      }
    }
    loadData();
  }, [user]);

  const formatCurrency = (value: string) => {
    const num = value.replace(/\D/g, '');
    return num ? parseInt(num).toLocaleString() : '';
  };

  const parseCurrency = (value: string) => parseInt(value.replace(/\D/g, '')) || 0;

  // Auto-calculate LTV when loan amount or value changes
  const value = parseCurrency(propertyValue);
  const amount = parseCurrency(desiredLoanAmount);
  const calculatedLtv = value > 0 ? ((amount / value) * 100).toFixed(1) : '';

  // Auto-calculate loan amount when LTV is entered
  const handleLtvChange = (ltvStr: string) => {
    setDesiredLtv(ltvStr);
    const ltv = parseFloat(ltvStr);
    if (ltv > 0 && value > 0) {
      setDesiredLoanAmount(formatCurrency(String(Math.round(value * ltv / 100))));
    }
  };

  const handleValueChange = (val: string) => {
    setPropertyValue(formatCurrency(val));
    const ltv = parseFloat(desiredLtv);
    const newValue = parseCurrency(val);
    if (ltv > 0 && newValue > 0) {
      setDesiredLoanAmount(formatCurrency(String(Math.round(newValue * ltv / 100))));
    }
  };

  const maxLoan = loanType === 'dscr' ? maxDscr : (loanType === 'bridge' ? maxDscr * 5 / 4 : maxFixFlip);
  const showRehabBudget = loanType === 'fix_flip' || loanType === 'bridge';
  const step = !loanPurpose ? 'purpose' : !loanType ? 'type' : 'details';

  // Fix & Flip / Bridge loan amount constraints
  const arvValue = parseCurrency(afterRepairValue);
  const rehabValue = parseCurrency(rehabBudget);
  const maxByArv = arvValue > 0 ? arvValue * 0.75 : Infinity;
  const maxByPurchaseRehab = (value > 0 || rehabValue > 0) ? (value * 0.9) + (rehabValue * 1.0) : Infinity;
  const fixFlipMaxLoan = showRehabBudget ? Math.min(maxByArv, maxByPurchaseRehab) : Infinity;
  const loanExceedsFixFlipMax = showRehabBudget && amount > 0 && fixFlipMaxLoan !== Infinity && amount > fixFlipMaxLoan;

  const handleSubmit = async () => {
    if (!borrowerId || !loanPurpose || !loanType) return;
    setError(null);
    setIsLoading(true);

    try {
      const loanAmount = parseCurrency(desiredLoanAmount);
      const propValue = parseCurrency(propertyValue);
      const ltv = propValue > 0 ? (loanAmount / propValue) * 100 : 0;
      const isRefi = loanPurpose === 'refinance';

      const { error: insertError } = await supabase.from('loan_scenarios').insert({
        borrower_id: borrowerId,
        scenario_name: `${isRefi ? 'Refinance' : 'Purchase'} - ${propertyAddress || 'New Property'}`,
        loan_type: loanType,
        loan_purpose: loanPurpose,
        property_address: propertyAddress,
        property_city: propertyCity,
        property_state: propertyState,
        property_zip: propertyZip,
        purchase_price: isRefi ? null : propValue,
        estimated_value: propValue,
        loan_amount: loanAmount,
        ltv: Math.round(ltv * 100) / 100,
        rehab_budget: showRehabBudget && rehabBudget ? parseCurrency(rehabBudget) : null,
        after_repair_value: showRehabBudget && afterRepairValue ? parseCurrency(afterRepairValue) : null,
        refinance_type: loanPurpose === 'refinance' ? refinanceType || null : null,
        status: 'submitted',
      });

      if (insertError) throw insertError;
      navigate('/application/loans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create loan');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'details') setLoanType(null);
    else if (step === 'type') setLoanPurpose(null);
    else navigate('/application/loans');
  };

  // Purchase requires liquidity verification
  if (loanPurpose === 'purchase' && !hasLiquidity) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10">
        <button onClick={() => setLoanPurpose(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Liquidity Verification Required</h2>
          <p className="text-gray-600 mb-6">You need to verify your liquidity before submitting a purchase loan. Go to your dashboard and connect your bank account or upload bank statements.</p>
          <button
            onClick={() => navigate('/application')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {step === 'details' ? 'Change loan type' : step === 'type' ? 'Change purpose' : 'Back to My Loans'}
      </button>

      <h1 className="text-3xl font-semibold text-gray-900 tracking-tight mb-2">New Loan</h1>
      <p className="text-gray-500 mb-8">
        {step === 'purpose' && 'What type of transaction is this?'}
        {step === 'type' && 'What type of loan do you need?'}
        {step === 'details' && (loanPurpose === 'refinance' ? 'Tell us about the property you want to refinance' : 'Tell us about the property you want to purchase')}
      </p>

      {/* Step 1: Purpose */}
      {step === 'purpose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setLoanPurpose('purchase')}
            className="flex flex-col items-center gap-4 p-8 border-2 border-gray-200 rounded-xl hover:border-teal-500 hover:bg-teal-50 transition-all group"
          >
            <div className="w-16 h-16 bg-teal-100 rounded-2xl flex items-center justify-center group-hover:bg-teal-200 transition-colors">
              <Home className="w-8 h-8 text-teal-700" />
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold text-gray-900">Purchase</p>
              <p className="text-sm text-gray-500 mt-1">Buy a new investment property</p>
            </div>
          </button>

          <button
            onClick={() => setLoanPurpose('refinance')}
            className="flex flex-col items-center gap-4 p-8 border-2 border-gray-200 rounded-xl hover:border-teal-500 hover:bg-teal-50 transition-all group"
          >
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <RefreshCw className="w-8 h-8 text-blue-700" />
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold text-gray-900">Refinance</p>
              <p className="text-sm text-gray-500 mt-1">Refinance an existing property</p>
            </div>
          </button>
        </div>
      )}

      {/* Step 2: Loan Type */}
      {step === 'type' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {LOAN_TYPES.map(({ key, label, description, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setLoanType(key)}
              className="flex flex-col items-center gap-3 p-6 border-2 border-gray-200 rounded-xl hover:border-teal-500 hover:bg-teal-50 transition-all group"
            >
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center group-hover:bg-teal-100 transition-colors">
                <Icon className="w-7 h-7 text-gray-600 group-hover:text-teal-700" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 mt-1">{description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 3: Property Details */}
      {step === 'details' && (
        <div className="space-y-5">
          {/* Refinance Type Selector */}
          {loanPurpose === 'refinance' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Refinance Type *</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setRefinanceType('rate_term')}
                  className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${refinanceType === 'rate_term' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                  Rate & Term
                </button>
                <button type="button" onClick={() => setRefinanceType('cash_out')}
                  className={`px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${refinanceType === 'cash_out' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                  Cash-Out
                </button>
              </div>
            </div>
          )}

          {maxLoan > 0 && loanPurpose !== 'refinance' && (
            <div className="bg-teal-50 border border-teal-100 rounded-lg px-4 py-3 text-sm text-teal-700">
              <DollarSign className="w-4 h-4 inline mr-1" />
              Pre-approved up to <strong>${maxLoan.toLocaleString()}</strong>
            </div>
          )}

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Property Address *</label>
            <input type="text" value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
              placeholder="123 Main St" required />
            <div className="grid grid-cols-6 gap-2 mt-2">
              <input type="text" value={propertyCity} onChange={e => setPropertyCity(e.target.value)}
                className="col-span-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="City" required />
              <select value={propertyState} onChange={e => setPropertyState(e.target.value)}
                className="col-span-1 px-2 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" required>
                <option value="">ST</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="text" value={propertyZip} onChange={e => setPropertyZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                className="col-span-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Zip" required />
            </div>
          </div>

          {/* Value */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {loanPurpose === 'refinance' ? 'As-Is Value *' : 'Purchase Price *'}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input type="text" value={propertyValue} onChange={e => handleValueChange(e.target.value)}
                className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="500,000" required />
            </div>
          </div>

          {/* LTV + Loan Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Desired LTV %</label>
              <div className="relative">
                <input type="number" value={desiredLtv} onChange={e => handleLtvChange(e.target.value)}
                  className="w-full px-4 py-3 pr-8 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="75" min={1} max={100} step={0.1} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Loan Amount *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input type="text" value={desiredLoanAmount} onChange={e => { setDesiredLoanAmount(formatCurrency(e.target.value)); setDesiredLtv(''); }}
                  className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="375,000" required />
              </div>
            </div>
          </div>

          {calculatedLtv && !desiredLtv && (
            <p className="text-xs text-gray-500 -mt-3">Calculated LTV: {calculatedLtv}%</p>
          )}

          {amount > maxLoan && maxLoan > 0 && loanPurpose !== 'refinance' && (
            <p className="text-xs text-amber-600 -mt-3">This exceeds your pre-approved maximum of ${maxLoan.toLocaleString()}</p>
          )}

          {/* Rehab Budget + ARV (Fix & Flip / Bridge only) */}
          {showRehabBudget && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rehab Budget</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input type="text" value={rehabBudget} onChange={e => setRehabBudget(formatCurrency(e.target.value))}
                      className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="75,000" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Estimated renovation cost</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">After Repair Value (ARV)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input type="text" value={afterRepairValue} onChange={e => setAfterRepairValue(formatCurrency(e.target.value))}
                      className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="500,000" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Estimated value after rehab</p>
                </div>
              </div>

              {/* Loan limit info */}
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

          {loanExceedsFixFlipMax && (
            <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
              Loan amount exceeds the maximum of ${Math.round(fixFlipMaxLoan).toLocaleString()}. The total loan cannot exceed 75% of ARV or 90% of purchase price + 100% of rehab budget.
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || !propertyAddress || !propertyValue || !desiredLoanAmount || loanExceedsFixFlipMax || (loanPurpose === 'refinance' && !refinanceType)}
            className="w-full py-3 px-4 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span>Submitting...</span></>
            ) : (
              <><span>Submit Loan Request</span><ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
