import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { generateSchedule, monthlyPayment, maturityDateFrom } from '../../lib/amortization';
import { onboardServicedLoan } from '../../services/servicingService';

interface BorrowerOption {
  id: string;
  borrower_name: string;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

export function OnboardServicedLoanPage() {
  const { user, userAccount } = useAuth();
  const { organization, member } = useTeam();
  const navigate = useNavigate();

  const [borrowers, setBorrowers] = useState<BorrowerOption[]>([]);
  const [borrowerId, setBorrowerId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loanNumber, setLoanNumber] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyZip, setPropertyZip] = useState('');
  const [originalPrincipal, setOriginalPrincipal] = useState('');
  const [interestRatePct, setInterestRatePct] = useState('');
  const [amortTermMonths, setAmortTermMonths] = useState('360');
  const [loanTermMonths, setLoanTermMonths] = useState('360');
  const [originationDate, setOriginationDate] = useState(new Date().toISOString().slice(0, 10));
  const [firstPaymentDate, setFirstPaymentDate] = useState('');
  const [escrowTaxes, setEscrowTaxes] = useState('0');
  const [escrowInsurance, setEscrowInsurance] = useState('0');
  const [lateFee, setLateFee] = useState('25');
  const [graceDays, setGraceDays] = useState('15');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdminLike =
    userAccount?.user_role === 'admin' ||
    userAccount?.user_role === 'reviewer' ||
    member?.role === 'owner' ||
    member?.role === 'admin';

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('borrowers')
        .select('id, borrower_name, email, address_street, address_city, address_state, address_zip')
        .order('borrower_name', { ascending: true });
      setBorrowers((data || []) as BorrowerOption[]);
    })();
  }, []);

  // Auto-default loan number when borrower picked
  useEffect(() => {
    if (borrowerId && !loanNumber) {
      const seed = Date.now().toString(36).toUpperCase().slice(-6);
      setLoanNumber(`KREC-${seed}`);
    }
  }, [borrowerId, loanNumber]);

  // When borrower changes, pre-fill property address from their profile
  useEffect(() => {
    if (!borrowerId) return;
    const b = borrowers.find(x => x.id === borrowerId);
    if (b && !propertyAddress) {
      setPropertyAddress(b.address_street || '');
      setPropertyCity(b.address_city || '');
      setPropertyState(b.address_state || '');
      setPropertyZip(b.address_zip || '');
    }
  }, [borrowerId, borrowers, propertyAddress]);

  // Default first payment to 1st of the month after origination
  useEffect(() => {
    if (originationDate && !firstPaymentDate) {
      const d = new Date(originationDate);
      d.setMonth(d.getMonth() + 1, 1);
      setFirstPaymentDate(d.toISOString().slice(0, 10));
    }
  }, [originationDate, firstPaymentDate]);

  const principalNum = parseFloat(originalPrincipal) || 0;
  const ratePct = parseFloat(interestRatePct) || 0;
  const rateDecimal = ratePct / 100;
  const amortN = parseInt(amortTermMonths) || 0;
  const loanN = parseInt(loanTermMonths) || amortN;
  const escrowMonthly = (parseFloat(escrowTaxes) || 0) + (parseFloat(escrowInsurance) || 0);

  const previewRows = useMemo(() => {
    if (!principalNum || !amortN || !firstPaymentDate) return [];
    try {
      return generateSchedule({
        principal: principalNum,
        annualInterestRate: rateDecimal,
        amortizationTermMonths: amortN,
        loanTermMonths: loanN,
        firstPaymentDate,
        escrowMonthly,
      });
    } catch {
      return [];
    }
  }, [principalNum, rateDecimal, amortN, loanN, firstPaymentDate, escrowMonthly]);

  const piPayment = principalNum && amortN
    ? monthlyPayment({ principal: principalNum, annualInterestRate: rateDecimal, amortizationTermMonths: amortN })
    : 0;
  const totalPayment = piPayment + escrowMonthly;
  const computedMaturity = firstPaymentDate && loanN ? maturityDateFrom(firstPaymentDate, loanN) : '';

  const filteredBorrowers = borrowers.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (b.borrower_name || '').toLowerCase().includes(q) || (b.email || '').toLowerCase().includes(q);
  });

  function validate(): string | null {
    if (!borrowerId) return 'Pick a borrower.';
    if (!loanNumber.trim()) return 'Loan number is required.';
    if (!principalNum) return 'Original principal is required.';
    if (!rateDecimal) return 'Interest rate is required.';
    if (!amortN) return 'Amortization term is required.';
    if (!loanN || loanN > amortN) return 'Loan term must be > 0 and ≤ amortization term.';
    if (!originationDate) return 'Origination date is required.';
    if (!firstPaymentDate) return 'First payment date is required.';
    return null;
  }

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    if (!organization || !user) { setError('No organization / user context.'); return; }
    setError(null);
    setSaving(true);
    try {
      const { loan } = await onboardServicedLoan({
        organization_id: organization.id,
        borrower_id: borrowerId,
        loan_number: loanNumber.trim(),
        property_address: propertyAddress || null,
        property_city: propertyCity || null,
        property_state: propertyState || null,
        property_zip: propertyZip || null,
        original_principal: principalNum,
        interest_rate: rateDecimal,
        amortization_term_months: amortN,
        loan_term_months: loanN,
        origination_date: originationDate,
        first_payment_date: firstPaymentDate,
        escrow_taxes_monthly: parseFloat(escrowTaxes) || 0,
        escrow_insurance_monthly: parseFloat(escrowInsurance) || 0,
        late_fee_amount: parseFloat(lateFee) || 0,
        grace_period_days: parseInt(graceDays) || 0,
      }, user.id);
      navigate(`/internal/servicing/${loan.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to onboard loan');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdminLike) {
    return <div className="text-center py-20"><p className="text-gray-500">You don't have permission to onboard serviced loans.</p></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/internal/servicing" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Onboard a Serviced Loan</h1>
          <p className="text-sm text-gray-500 mt-1">Enter terms for a closed loan. We'll generate the full amortization on save.</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Borrower</h2>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <select
          value={borrowerId}
          onChange={e => setBorrowerId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          size={Math.min(8, filteredBorrowers.length + 1)}
        >
          <option value="">— Pick a borrower —</option>
          {filteredBorrowers.map(b => (
            <option key={b.id} value={b.id}>
              {b.borrower_name} {b.email ? `· ${b.email}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Loan Terms</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loan Number *" value={loanNumber} onChange={setLoanNumber} mono />
          <Field label="Original Principal ($) *" value={originalPrincipal} onChange={setOriginalPrincipal} placeholder="300000" type="number" />
          <Field label="Interest Rate (%) *" value={interestRatePct} onChange={setInterestRatePct} placeholder="7.25" type="number" step="0.001" />
          <Field label="Amortization Term (months) *" value={amortTermMonths} onChange={setAmortTermMonths} type="number" />
          <Field label="Loan Term (months) *" value={loanTermMonths} onChange={setLoanTermMonths} type="number" />
          <Field label="Origination Date *" value={originationDate} onChange={setOriginationDate} type="date" />
          <Field label="First Payment Date *" value={firstPaymentDate} onChange={setFirstPaymentDate} type="date" />
          <Field label="Maturity Date" value={computedMaturity || '—'} readOnly />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Property</h2>
        <Field label="Street Address" value={propertyAddress} onChange={setPropertyAddress} />
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-3"><Field label="City" value={propertyCity} onChange={setPropertyCity} /></div>
          <div className="col-span-1"><Field label="State" value={propertyState} onChange={setPropertyState} /></div>
          <div className="col-span-2"><Field label="ZIP" value={propertyZip} onChange={setPropertyZip} /></div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Escrow + Late Fees</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly Taxes ($)" value={escrowTaxes} onChange={setEscrowTaxes} type="number" />
          <Field label="Monthly Insurance ($)" value={escrowInsurance} onChange={setEscrowInsurance} type="number" />
          <Field label="Late Fee ($)" value={lateFee} onChange={setLateFee} type="number" />
          <Field label="Grace Period (days)" value={graceDays} onChange={setGraceDays} type="number" />
        </div>
      </div>

      {previewRows.length > 0 && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-teal-900">Amortization Preview</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
              <p className="text-xs text-gray-500">Monthly P+I</p>
              <p className="font-semibold text-gray-900">${piPayment.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
              <p className="text-xs text-gray-500">Monthly Total (P+I+Escrow)</p>
              <p className="font-semibold text-gray-900">${totalPayment.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
              <p className="text-xs text-gray-500">Schedule Rows</p>
              <p className="font-semibold text-gray-900">{previewRows.length}</p>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-teal-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right">Principal</th>
                  <th className="px-3 py-2 text-right">Interest</th>
                  <th className="px-3 py-2 text-right">Escrow</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...previewRows.slice(0, 6), ...(previewRows.length > 12 ? previewRows.slice(-6) : previewRows.slice(6))].map((r, i) => (
                  <>
                    {i === 6 && previewRows.length > 12 && (
                      <tr key="sep" className="bg-gray-50"><td colSpan={7} className="text-center text-gray-400 py-1">… {previewRows.length - 12} rows omitted …</td></tr>
                    )}
                    <tr key={r.paymentNumber}>
                      <td className="px-3 py-1.5">{r.paymentNumber}</td>
                      <td className="px-3 py-1.5">{r.dueDate}</td>
                      <td className="px-3 py-1.5 text-right">${r.scheduledPrincipal.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right">${r.scheduledInterest.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right">${r.scheduledEscrow.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-medium">${r.scheduledTotal.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right">${r.endingBalance.toFixed(2)}</td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link to="/internal/servicing" className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</Link>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Onboarding…' : 'Onboard Loan'}
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
}
function Field({ label, value, onChange, type = 'text', step, placeholder, mono, readOnly }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        step={step}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 ${mono ? 'font-mono' : ''} ${readOnly ? 'bg-gray-50 text-gray-600' : ''}`}
      />
    </div>
  );
}
