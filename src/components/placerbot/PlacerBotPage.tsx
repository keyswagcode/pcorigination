import { useState, useMemo } from 'react';
import { Bot, CheckCircle, XCircle, AlertTriangle, Star, ChevronLeft, RefreshCw, Zap, Target, ArrowRight } from 'lucide-react';
import { runPlacerBot, type DealInput, type PlacerBotResult, type LenderResult } from '../../services/placerbot/eligibilityEngine';
import type { LoanPurpose, HousingHistory } from '../../services/placerbot/verusEngine';
import type { QualificationPreference, LoanType } from '../../services/placerbot/loanTypeRouter';

interface PlacerBotPageProps {
  onBack?: () => void;
  initialBorrower?: {
    credit_score?: number | null;
    dscr?: number | null;
    seasoning_months?: number | null;
    short_term_rental?: boolean | null;
    foreign_national?: boolean | null;
    first_time_investor?: boolean | null;
    domestic_or_international?: string | null;
    real_estate_experience_years?: number | null;
    properties_owned_count?: number | null;
  } | null;
}

const PROPERTY_TYPE_OPTIONS = [
  { value: 'investment', label: 'Investment / Rental (SFR)' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: '2-4 unit', label: '2-4 Unit' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'primary', label: 'Primary Residence' },
];

const LOAN_PURPOSE_OPTIONS: { value: LoanPurpose; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'rate_term_refinance', label: 'Rate/Term Refinance' },
  { value: 'cash_out_refinance', label: 'Cash-Out Refinance' },
];

const HOUSING_HISTORY_OPTIONS: { value: HousingHistory; label: string }[] = [
  { value: 'clean', label: 'Clean (no lates)' },
  { value: '1x30', label: '1x30 (one 30-day late)' },
  { value: '0x60', label: '0x60 (60-day late)' },
  { value: 'other', label: 'Other derogatory' },
];

interface RequirementItem {
  label: string;
  field: string;
  complete: boolean;
  type: 'field' | 'document';
}

function deriveDefaults(b: PlacerBotPageProps['initialBorrower']): Partial<DealInput> {
  if (!b) return {};
  return {
    credit_score: b.credit_score ?? null,
    dscr: b.dscr ?? null,
    seasoning_months: b.seasoning_months ?? null,
    short_term_rental: b.short_term_rental ?? false,
    foreign_national: b.foreign_national ?? (b.domestic_or_international === 'international'),
    first_time_investor:
      b.first_time_investor ??
      (b.real_estate_experience_years === 0 || (b.properties_owned_count != null && b.properties_owned_count === 0)),
  };
}

function detectLoanType(form: DealInput): { type: LoanType; reason: string; canDSCR: boolean; canNQM: boolean } {
  const hasPersonalIncome = (form.total_bank_deposits ?? 0) > 0 || (form.bank_statement_months ?? 0) > 0;
  const hasRentalIncome = (form.monthly_rent ?? 0) > 0;
  const isInvestment = form.property_type === 'investment' || form.property_type === '2-4 unit';

  const canDSCR = isInvestment && hasRentalIncome;
  const canNQM = hasPersonalIncome;

  if (hasPersonalIncome) {
    return {
      type: 'NQM',
      reason: 'Bank statement income provided',
      canDSCR,
      canNQM,
    };
  }

  if (canDSCR) {
    return {
      type: 'DSCR',
      reason: 'Investment property with rental income',
      canDSCR,
      canNQM,
    };
  }

  return {
    type: 'MANUAL_REVIEW',
    reason: 'No qualifying income source identified',
    canDSCR,
    canNQM,
  };
}

function getRequirementsChecklist(
  loanType: 'DSCR' | 'NQM' | 'auto',
  form: DealInput
): RequirementItem[] {
  const items: RequirementItem[] = [];

  items.push({
    label: 'Credit Score',
    field: 'credit_score',
    complete: form.credit_score != null && form.credit_score > 0,
    type: 'field',
  });
  items.push({
    label: 'Loan Amount',
    field: 'loan_amount',
    complete: form.loan_amount != null && form.loan_amount > 0,
    type: 'field',
  });
  items.push({
    label: 'Property Value',
    field: 'property_value',
    complete: form.property_value != null && form.property_value > 0,
    type: 'field',
  });

  if (loanType === 'DSCR') {
    items.push({
      label: 'Monthly Rent',
      field: 'monthly_rent',
      complete: form.monthly_rent != null && form.monthly_rent > 0,
      type: 'field',
    });
    items.push({
      label: 'Liquid Reserves',
      field: 'liquidity',
      complete: form.liquidity != null && form.liquidity > 0,
      type: 'field',
    });
    items.push({
      label: 'Lease Agreement or Rent Schedule',
      field: 'lease_agreement',
      complete: false,
      type: 'document',
    });
  }

  if (loanType === 'NQM') {
    items.push({
      label: 'Monthly Bank Deposits',
      field: 'total_bank_deposits',
      complete: form.total_bank_deposits != null && form.total_bank_deposits > 0,
      type: 'field',
    });
    items.push({
      label: 'Statement Period (12 or 24 mo)',
      field: 'bank_statement_months',
      complete: form.bank_statement_months != null && form.bank_statement_months > 0,
      type: 'field',
    });
    items.push({
      label: 'Bank Statements',
      field: 'bank_statements',
      complete: false,
      type: 'document',
    });
  }

  if (loanType === 'auto') {
    items.push({
      label: 'Income source (rent OR bank deposits)',
      field: 'income_source',
      complete: (form.monthly_rent ?? 0) > 0 || (form.total_bank_deposits ?? 0) > 0,
      type: 'field',
    });
  }

  return items;
}

function LtvBar({ actual, max }: { actual: number; max: number }) {
  const pct = Math.min(100, (actual / max) * 100);
  const color = pct > 95 ? 'bg-red-500' : pct > 85 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Actual LTV: {actual.toFixed(1)}%</span>
        <span>Max: {max.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LenderCard({ r, showSalvage = false }: { r: LenderResult; showSalvage?: boolean }) {
  const isClosestOption = r.fit_category === 'closest_option';
  const isBorderline = r.borderline;
  const borderColor = r.eligible
    ? 'border-emerald-100 bg-emerald-50/40'
    : isClosestOption
      ? 'border-blue-200 bg-blue-50/40'
      : isBorderline
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-gray-200 bg-white';
  const icon = r.eligible
    ? <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
    : isClosestOption
      ? <Target className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
      : isBorderline
        ? <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />;

  const fitLabel = r.fit_category === 'strong_fit' ? 'Strong Fit'
    : r.fit_category === 'good_fit' ? 'Good Fit'
    : r.fit_category === 'conditional_fit' ? 'Conditional'
    : r.fit_category === 'closest_option' ? 'Closest Option'
    : null;

  return (
    <div className={`p-4 border rounded-xl ${borderColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2.5">
          {icon}
          <div>
            <p className="font-semibold text-gray-900 text-sm">{r.lender.name}</p>
            <p className="text-xs text-gray-500">{r.lender.program}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {r.score != null && (
            <span className="text-xs font-medium text-gray-400">{r.score}%</span>
          )}
          {fitLabel && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              r.fit_category === 'strong_fit' ? 'bg-emerald-100 text-emerald-700'
              : r.fit_category === 'good_fit' ? 'bg-teal-100 text-teal-700'
              : r.fit_category === 'conditional_fit' ? 'bg-amber-100 text-amber-700'
              : 'bg-blue-100 text-blue-700'
            }`}>
              {fitLabel}
            </span>
          )}
        </div>
      </div>
      {r.strategy_reason && (
        <p className="text-xs text-gray-600 mt-2 ml-7">{r.strategy_reason}</p>
      )}
      {r.passing_criteria && r.passing_criteria.length > 0 && (
        <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
          {r.passing_criteria.slice(0, 4).map((c, i) => (
            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{c}</span>
          ))}
        </div>
      )}
      {r.reasons.length > 0 && !r.eligible && (
        <ul className="mt-2 ml-7 space-y-1">
          {r.reasons.map((reason, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
              <span className="w-1 h-1 bg-red-400 rounded-full flex-shrink-0 mt-1.5" />
              {reason}
            </li>
          ))}
        </ul>
      )}
      {r.borderline_flags && r.borderline_flags.length > 0 && (
        <ul className="mt-2 ml-7 space-y-1">
          {r.borderline_flags.map((flag, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              {flag}
            </li>
          ))}
        </ul>
      )}
      {showSalvage && r.salvage_suggestions && r.salvage_suggestions.length > 0 && (
        <div className="mt-3 ml-7 p-2.5 bg-blue-50/50 rounded-lg border border-blue-100">
          <p className="text-xs font-semibold text-blue-700 mb-1.5">How to qualify:</p>
          <ul className="space-y-1">
            {r.salvage_suggestions.map((s, i) => (
              <li key={i} className="text-xs text-blue-600 flex items-start gap-1.5">
                <span className="text-blue-400">-</span>
                <span><strong>{s.field}:</strong> {s.fix}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.max_allowed_ltv != null && r.actual_ltv != null && (
        <div className="mt-2 ml-7">
          <LtvBar actual={r.actual_ltv} max={r.max_allowed_ltv} />
        </div>
      )}
    </div>
  );
}

function RequirementsChecklist({ items, loanTypeLabel }: { items: RequirementItem[]; loanTypeLabel: string }) {
  const completed = items.filter(i => i.complete).length;
  const total = items.length;
  const allComplete = completed === total;

  return (
    <div className={`rounded-xl border p-4 ${allComplete ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          Requirements for {loanTypeLabel}
        </h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          allComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {completed}/{total}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.field} className="flex items-center gap-2">
            {item.complete ? (
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-gray-300 flex-shrink-0" />
            )}
            <span className={`text-sm ${item.complete ? 'text-gray-700' : 'text-gray-500'}`}>
              {item.label}
            </span>
            {item.type === 'document' && (
              <span className="text-xs text-gray-400 ml-auto">(document)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlacerBotPage({ onBack, initialBorrower }: PlacerBotPageProps) {
  const defaults = deriveDefaults(initialBorrower);

  const [form, setForm] = useState<DealInput>({
    credit_score: defaults.credit_score ?? null,
    dscr: defaults.dscr ?? null,
    monthly_rent: null,
    monthly_payment: null,
    property_type: 'investment',
    seasoning_months: defaults.seasoning_months ?? null,
    short_term_rental: defaults.short_term_rental ?? false,
    foreign_national: defaults.foreign_national ?? false,
    first_time_investor: defaults.first_time_investor ?? false,
    loan_amount: null,
    property_value: null,
    liquidity: null,
    loan_purpose: 'purchase',
    state: null,
    is_vacant: false,
    is_declining_market: false,
    housing_history: 'clean',
    credit_event_months_since: null,
    qualification_preference: 'auto',
    total_bank_deposits: null,
    bank_statement_months: null,
  });

  const [result, setResult] = useState<PlacerBotResult | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const detected = useMemo(() => detectLoanType(form), [form]);

  const effectiveLoanType: 'DSCR' | 'NQM' | 'auto' = form.qualification_preference === 'dscr'
    ? 'DSCR'
    : form.qualification_preference === 'income'
      ? 'NQM'
      : 'auto';

  const loanTypeLabel = effectiveLoanType === 'DSCR'
    ? 'DSCR (Property Income)'
    : effectiveLoanType === 'NQM'
      ? 'NQM (Bank Statements)'
      : detected.type === 'DSCR'
        ? 'DSCR (Auto-detected)'
        : detected.type === 'NQM'
          ? 'NQM (Auto-detected)'
          : 'Unknown';

  const requirements = useMemo(() => {
    const type = effectiveLoanType === 'auto' ? detected.type : effectiveLoanType;
    return getRequirementsChecklist(type === 'MANUAL_REVIEW' ? 'auto' : type, form);
  }, [effectiveLoanType, detected.type, form]);

  const isDSCR = form.qualification_preference === 'dscr';
  const isNQM = form.qualification_preference === 'income';
  const isAuto = form.qualification_preference === 'auto';

  function setNum(field: keyof DealInput, raw: string) {
    const v = raw === '' ? null : parseFloat(raw);
    setForm((prev) => ({ ...prev, [field]: isNaN(v as number) ? null : v }));
  }

  function setBool(field: keyof DealInput, val: boolean) {
    setForm((prev) => ({ ...prev, [field]: val }));
  }

  function handleLoanTypeChange(pref: QualificationPreference) {
    setForm((prev) => ({
      ...prev,
      qualification_preference: pref,
      ...(pref === 'dscr' ? { total_bank_deposits: null, bank_statement_months: null } : {}),
      ...(pref === 'income' ? { monthly_rent: null, dscr: null } : {}),
    }));
    setResult(null);
    setHasRun(false);
  }

  function runAnalysis() {
    const res = runPlacerBot(form);
    setResult(res);
    setHasRun(true);
  }

  function runAsAlternate(type: 'DSCR' | 'NQM') {
    const pref: QualificationPreference = type === 'DSCR' ? 'dscr' : 'income';
    const newForm = { ...form, qualification_preference: pref };
    setForm(newForm);
    const res = runPlacerBot(newForm);
    setResult(res);
    setHasRun(true);
  }

  function reset() {
    setResult(null);
    setHasRun(false);
  }

  const fieldRequirements = requirements.filter(r => r.type === 'field');
  const completedFields = fieldRequirements.filter(r => r.complete).length;
  const canRun = completedFields >= fieldRequirements.length - 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">PlacerBot</h1>
              <p className="text-sm text-gray-500">Lender eligibility and routing</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <label className="block text-xs font-semibold text-gray-600 mb-3">How does borrower qualify?</label>
          <div className="flex gap-3">
            {([
              { value: 'auto' as const, label: 'Auto-detect', desc: 'System picks based on inputs' },
              { value: 'dscr' as const, label: 'Force DSCR', desc: 'Property income only' },
              { value: 'income' as const, label: 'Force NQM', desc: 'Bank statements only' },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleLoanTypeChange(opt.value)}
                className={`flex-1 px-4 py-3 text-left rounded-xl border-2 transition-all ${
                  form.qualification_preference === opt.value
                    ? 'bg-teal-50 border-teal-400'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className={`block text-sm font-semibold ${
                  form.qualification_preference === opt.value ? 'text-teal-700' : 'text-gray-700'
                }`}>
                  {opt.label}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">{opt.desc}</span>
              </button>
            ))}
          </div>

          {isAuto && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-teal-600" />
                <span className="text-sm font-medium text-gray-700">
                  Detected: <span className="text-teal-700">{detected.type}</span>
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-6">{detected.reason}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          <div className="lg:col-span-2 space-y-4">

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Deal Basics</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Credit Score <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 720"
                    value={form.credit_score ?? ''}
                    onChange={(e) => setNum('credit_score', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Loan Purpose</label>
                  <select
                    value={form.loan_purpose ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, loan_purpose: e.target.value as LoanPurpose }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  >
                    {LOAN_PURPOSE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Property Type</label>
                  <select
                    value={form.property_type ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, property_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  >
                    <option value="">Select type...</option>
                    {PROPERTY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Loan Amount ($) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 500000"
                      value={form.loan_amount ?? ''}
                      onChange={(e) => setNum('loan_amount', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Property Value ($) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 650000"
                      value={form.property_value ?? ''}
                      onChange={(e) => setNum('property_value', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {(isDSCR || isAuto) && (
              <div className={`bg-white rounded-2xl border p-5 shadow-sm ${isDSCR ? 'border-teal-300' : 'border-gray-200'}`}>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  Property Income (DSCR)
                  {isDSCR && <span className="ml-2 text-teal-600 normal-case font-bold">FORCED</span>}
                </h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Monthly Rent ($) {isDSCR && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 3200"
                        value={form.monthly_rent ?? ''}
                        onChange={(e) => setNum('monthly_rent', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Liquid Reserves ($) {isDSCR && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 50000"
                        value={form.liquidity ?? ''}
                        onChange={(e) => setNum('liquidity', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">DSCR Ratio (optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 1.25"
                      value={form.dscr ?? ''}
                      onChange={(e) => setNum('dscr', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">Leave blank to auto-calculate from rent/payment</p>
                  </div>
                </div>
              </div>
            )}

            {(isNQM || isAuto) && (
              <div className={`bg-white rounded-2xl border p-5 shadow-sm ${isNQM ? 'border-teal-300' : 'border-gray-200'}`}>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  Personal Income (NQM)
                  {isNQM && <span className="ml-2 text-teal-600 normal-case font-bold">FORCED</span>}
                </h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Monthly Deposits ($) {isNQM && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 25000"
                        value={form.total_bank_deposits ?? ''}
                        onChange={(e) => setNum('total_bank_deposits', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Statement Months {isNQM && <span className="text-red-500">*</span>}
                      </label>
                      <select
                        value={form.bank_statement_months ?? ''}
                        onChange={(e) => setNum('bank_statement_months', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                      >
                        <option value="">Select...</option>
                        <option value="12">12 months</option>
                        <option value="24">24 months</option>
                      </select>
                    </div>
                  </div>
                  {isNQM && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Liquid Reserves ($)</label>
                      <input
                        type="number"
                        placeholder="e.g. 50000"
                        value={form.liquidity ?? ''}
                        onChange={(e) => setNum('liquidity', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Borrower Profile</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">State (2-letter)</label>
                    <input
                      type="text"
                      placeholder="e.g. TX"
                      maxLength={2}
                      value={form.state ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value.toUpperCase() || null }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Seasoning (months)</label>
                    <input
                      type="number"
                      placeholder="e.g. 12"
                      value={form.seasoning_months ?? ''}
                      onChange={(e) => setNum('seasoning_months', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Housing History</label>
                  <select
                    value={form.housing_history ?? 'clean'}
                    onChange={(e) => setForm((prev) => ({ ...prev, housing_history: e.target.value as HousingHistory }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  >
                    {HOUSING_HISTORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2.5 pt-1">
                  {(
                    [
                      { field: 'short_term_rental', label: 'Short-Term Rental (Airbnb / VRBO)' },
                      { field: 'foreign_national', label: 'Foreign National' },
                      { field: 'first_time_investor', label: 'First-Time Investor' },
                      { field: 'is_vacant', label: 'Property is Currently Vacant' },
                      { field: 'is_declining_market', label: 'Declining Market Area' },
                    ] as { field: keyof DealInput; label: string }[]
                  ).map(({ field, label }) => (
                    <label key={field} className="flex items-center gap-3 cursor-pointer">
                      <div
                        onClick={() => setBool(field, !(form[field] as boolean))}
                        className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${form[field] ? 'bg-teal-500' : 'bg-gray-200'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[field] ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </div>
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <RequirementsChecklist items={requirements} loanTypeLabel={loanTypeLabel} />

            <button
              onClick={hasRun ? reset : runAnalysis}
              disabled={!canRun && !hasRun}
              className={`w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                hasRun
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : canRun
                    ? 'bg-teal-600 text-white hover:bg-teal-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {hasRun ? (
                <><RefreshCw className="w-4 h-4" /> Reset</>
              ) : (
                <><Zap className="w-4 h-4" /> Run PlacerBot</>
              )}
            </button>
          </div>

          <div className="lg:col-span-3 space-y-4">
            {!hasRun && (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 flex flex-col items-center justify-center text-center shadow-sm">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Bot className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-semibold text-gray-700 mb-1">Ready to evaluate</h3>
                <p className="text-sm text-gray-400 max-w-xs">
                  Fill in the deal parameters and click Run PlacerBot to see lender eligibility results.
                </p>
              </div>
            )}

            {hasRun && result && (
              <div className="space-y-4">

                {result.validation_errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-5 h-5 text-red-500" />
                      <h2 className="text-sm font-semibold text-red-700">Missing Required Information</h2>
                    </div>
                    <ul className="space-y-2">
                      {result.validation_errors.map((error, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-red-600">
                          <span className="w-1.5 h-1.5 bg-red-400 rounded-full flex-shrink-0 mt-2" />
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.validation_errors.length === 0 && (
                  <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-teal-600 uppercase tracking-wider">Evaluated As</p>
                        <p className="text-xl font-bold text-teal-800 mt-1">{result.recommended_loan_type}</p>
                      </div>
                      <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
                        <Bot className="w-6 h-6 text-teal-600" />
                      </div>
                    </div>
                    <p className="text-sm text-teal-700 mt-2">{result.routing_reason}</p>

                    {(detected.canDSCR || detected.canNQM) && (
                      <div className="mt-4 pt-4 border-t border-teal-200">
                        <p className="text-xs font-medium text-teal-600 mb-2">Try a different structure:</p>
                        <div className="flex gap-2">
                          {detected.canDSCR && result.recommended_loan_type !== 'DSCR' && (
                            <button
                              onClick={() => runAsAlternate('DSCR')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-teal-300 rounded-lg text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              Try as DSCR
                            </button>
                          )}
                          {detected.canNQM && result.recommended_loan_type !== 'NQM' && (
                            <button
                              onClick={() => runAsAlternate('NQM')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-teal-300 rounded-lg text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              Try as NQM
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {result.flags.length > 0 && result.validation_errors.length === 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Deal Flags</h2>
                    <div className="flex flex-wrap gap-2">
                      {result.flags.map((flag) => (
                        <span
                          key={flag.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                            flag.type === 'positive'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {flag.type === 'positive' ? <Star className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {flag.label}
                        </span>
                      ))}
                    </div>
                    {result.computed_dscr != null && !form.dscr && (
                      <p className="text-xs text-gray-400 mt-3">
                        Computed DSCR: <span className="font-semibold text-gray-600">{result.computed_dscr.toFixed(2)}</span> (from rent / payment)
                      </p>
                    )}
                  </div>
                )}

                {result.eligible.length > 0 && result.validation_errors.length === 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Top Matches
                        <span className="ml-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {result.eligible.length}
                        </span>
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {result.eligible.map((r) => <LenderCard key={r.lender.id} r={r} />)}
                    </div>
                  </div>
                )}

                {result.borderline.length > 0 && result.validation_errors.length === 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Conditional - Review Required
                        <span className="ml-2 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                          {result.borderline.length}
                        </span>
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {result.borderline.map((r) => <LenderCard key={r.lender.id} r={r} />)}
                    </div>
                  </div>
                )}

                {result.closest_options.length > 0 && result.eligible.length === 0 && result.validation_errors.length === 0 && (
                  <div className="bg-white rounded-2xl border border-blue-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-blue-500" />
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Closest Options
                        <span className="ml-2 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          {result.closest_options.length}
                        </span>
                      </h2>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                      No perfect matches found, but these lenders are closest. See how to qualify below.
                    </p>
                    <div className="space-y-3">
                      {result.closest_options.map((r) => <LenderCard key={r.lender.id} r={r} showSalvage />)}
                    </div>
                  </div>
                )}

                {result.eligible.length === 0 && result.borderline.length === 0 && result.closest_options.length === 0 && result.validation_errors.length === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center shadow-sm">
                    <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                    <p className="font-semibold text-amber-800 mb-2">No lender match found</p>
                    <p className="text-sm text-amber-700">
                      Based on the provided profile, no lenders currently match. Try adjusting credit score, LTV, or loan amount.
                    </p>
                  </div>
                )}

                {result.validation_errors.length === 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {result.eligible.length} eligible / {result.borderline.length} conditional / {result.closest_options.length} closest
                    </span>
                    <button
                      onClick={runAnalysis}
                      className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Re-run
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
