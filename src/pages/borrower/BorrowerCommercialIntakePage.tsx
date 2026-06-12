import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, CheckCircle2, Download, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  COMMERCIAL_LOAN_TYPES, COMMERCIAL_PROPERTY_TYPES, SUPPORTING_DOCUMENTS,
  emptyCommercialIntake, emptyCommercialPrincipal,
  type CommercialIntake,
} from '../../shared/commercialIntake';
import { downloadCommercialIntakePdf, commercialIntakePdfBase64, type CommercialIntakeMeta } from '../../lib/commercialIntakeGenerator';
import { syncLoanCreatedToGhl } from '../../services/ghlSyncService';

export default function BorrowerCommercialIntakePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [borrowerName, setBorrowerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<CommercialIntake>(emptyCommercialIntake());
  const [submitted, setSubmitted] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('borrowers').select('id, borrower_name, email').eq('user_id', user.id).maybeSingle();
      setBorrowerId(data?.id ?? null);
      setBorrowerName(data?.borrower_name ?? '');
      setEmailTo(data?.email ?? '');
      setLoading(false);
    })();
  }, [user]);

  const pdfMeta = (): CommercialIntakeMeta => ({
    orgName: 'Key Real Estate Capital',
    borrowerName: borrowerName || form.borrowingEntityName,
    generatedDate: new Date().toLocaleDateString(),
  });

  const emailIntake = async () => {
    setEmailing(true);
    setEmailMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const safe = (borrowerName || form.borrowingEntityName || 'commercial').replace(/[^a-zA-Z0-9]+/g, '_');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-commercial-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          to: emailTo,
          borrowerName: borrowerName || form.borrowingEntityName,
          fileName: `commercial_intake_${safe}.pdf`,
          pdfBase64: commercialIntakePdfBase64(form, pdfMeta()),
          orgName: 'Key Real Estate Capital',
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to send');
      setEmailMsg(`Sent to ${(j.sentTo || [emailTo]).join(', ')}`);
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setEmailing(false);
    }
  };

  const set = <K extends keyof CommercialIntake>(k: K, v: CommercialIntake[K]) => setForm(f => ({ ...f, [k]: v }));
  const toggleArr = (k: 'loanTypes' | 'supportingDocs', v: string) =>
    setForm(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }));

  const submit = async () => {
    if (!borrowerId) { setError('No borrower profile found.'); return; }
    setSaving(true);
    setError('');
    try {
      const { data, error: insErr } = await supabase.from('loan_scenarios').insert({
        borrower_id: borrowerId,
        scenario_name: form.projectName || form.borrowingEntityName || 'Commercial Loan',
        loan_type: 'commercial',
        property_address: form.projectAddress || null,
        property_type: form.primaryPropertyType || null,
        loan_amount: form.requestedLoanAmount,
        commercial_intake: form,
        status: 'submitted',
      }).select('id').single();
      if (insErr) throw insErr;
      // CRM: update the GHL contact and open an opportunity for this loan.
      // Fire-and-forget — CRM lag must never block the borrower flow.
      if (data?.id) syncLoanCreatedToGhl(borrowerId, data.id);
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  // ---- input helpers ----
  const ic = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600';
  const Txt = ({ label, value, onChange, ph }: { label: string; value: string; onChange: (v: string) => void; ph?: string }) => (
    <label className="block text-sm"><span className="text-gray-600">{label}</span>
      <input type="text" value={value} placeholder={ph} onChange={e => onChange(e.target.value)} className={`${ic} mt-1`} /></label>
  );
  const Num = ({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) => (
    <label className="block text-sm"><span className="text-gray-600">{label}</span>
      <input type="text" inputMode="decimal" value={value ?? ''} onChange={e => { const d = e.target.value.replace(/[^0-9.]/g, ''); onChange(d === '' ? null : Number(d)); }} className={`${ic} mt-1`} /></label>
  );
  const Area = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <label className="block text-sm"><span className="text-gray-600">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={`${ic} mt-1`} /></label>
  );
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
  const YesNo = ({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-600">{label}</span>
      <div className="flex gap-3">
        {[['Yes', true], ['No', false]].map(([l, v]) => (
          <label key={l as string} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={value === v} onChange={() => onChange(v as boolean)} className="text-teal-600" /> {l as string}
          </label>
        ))}
      </div>
    </div>
  );

  if (loading) return <div className="max-w-3xl mx-auto px-6 py-10 text-gray-500">Loading…</div>;

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9 text-teal-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Commercial Request Submitted</h1>
          <p className="text-gray-500 mt-1">Your intake is ready. Download it or email a copy to a lender, advisor, or yourself.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <button
            onClick={() => downloadCommercialIntakePdf(form, pdfMeta())}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 font-medium text-gray-800"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email a copy to</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="recipient@example.com"
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                onClick={emailIntake}
                disabled={emailing || !emailTo}
                className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                <Mail className="w-4 h-4" /> {emailing ? 'Sending…' : 'Email'}
              </button>
            </div>
            {emailMsg && <p className="text-xs text-gray-600 mt-1.5">{emailMsg}</p>}
          </div>

          <div className="flex justify-between pt-2 border-t border-gray-100">
            <button onClick={() => setSubmitted(false)} className="text-sm text-gray-500 hover:text-gray-700">Edit request</button>
            <button onClick={() => navigate('/application/loans')} className="text-sm font-medium text-teal-600 hover:text-teal-700">Go to My Loans →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <button onClick={() => navigate('/application/new-loan')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-semibold text-gray-900">Commercial Project Intake &amp; Loan Request</h1>
      <p className="text-gray-500 mt-1 mb-6">Complete to the best of your ability — used for underwriting and lender placement. All fields optional.</p>

      <div className="space-y-5">
        <Section title="Overview & Loan Information">
          <Txt label="Date" value={form.date} onChange={v => set('date', v)} ph="mm/dd/yyyy" />
          <Num label="Requested Loan Amount" value={form.requestedLoanAmount} onChange={v => set('requestedLoanAmount', v)} />
          <Txt label="Loan Term / Duration" value={form.loanTermDuration} onChange={v => set('loanTermDuration', v)} />
          <Txt label="Target Closing Deadline" value={form.targetClosingDeadline} onChange={v => set('targetClosingDeadline', v)} />
          <Txt label="Reason for Deadline" value={form.reasonForDeadline} onChange={v => set('reasonForDeadline', v)} />
        </Section>

        <Section title="Loan Type Request">
          <p className="text-xs text-gray-500">Select all that apply:</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {COMMERCIAL_LOAN_TYPES.map(t => (
              <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.loanTypes.includes(t)} onChange={() => toggleArr('loanTypes', t)} className="rounded text-teal-600" /> {t}
              </label>
            ))}
          </div>
          <Num label="Target Loan Size" value={form.targetLoanSize} onChange={v => set('targetLoanSize', v)} />
          <Txt label="Target Leverage (LTV / LTC)" value={form.targetLeverage} onChange={v => set('targetLeverage', v)} />
          <YesNo label="Interest-Only Required?" value={form.interestOnlyRequired} onChange={v => set('interestOnlyRequired', v)} />
          <label className="block text-sm"><span className="text-gray-600">Recourse Preference</span>
            <select value={form.recoursePreference ?? ''} onChange={e => set('recoursePreference', (e.target.value || null) as CommercialIntake['recoursePreference'])} className={`${ic} mt-1`}>
              <option value="">—</option><option value="recourse">Recourse</option><option value="non_recourse">Non-Recourse</option><option value="flexible">Flexible</option>
            </select></label>
        </Section>

        <Section title="Property Type">
          <label className="block text-sm"><span className="text-gray-600">Primary Property Type</span>
            <select value={form.primaryPropertyType} onChange={e => set('primaryPropertyType', e.target.value)} className={`${ic} mt-1`}>
              <option value="">—</option>{COMMERCIAL_PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select></label>
          {form.primaryPropertyType === 'Other' && <Txt label="Other property type" value={form.primaryPropertyTypeOther} onChange={v => set('primaryPropertyTypeOther', v)} />}
          <label className="block text-sm"><span className="text-gray-600">Property Class</span>
            <select value={form.propertyClass ?? ''} onChange={e => set('propertyClass', (e.target.value || null) as CommercialIntake['propertyClass'])} className={`${ic} mt-1`}>
              <option value="">—</option><option value="A">Class A</option><option value="B">Class B</option><option value="C">Class C</option><option value="NA">Not Applicable</option>
            </select></label>
          <label className="block text-sm"><span className="text-gray-600">Stabilization Status</span>
            <select value={form.stabilizationStatus ?? ''} onChange={e => set('stabilizationStatus', (e.target.value || null) as CommercialIntake['stabilizationStatus'])} className={`${ic} mt-1`}>
              <option value="">—</option><option value="stabilized">Stabilized</option><option value="value_add">Value-Add</option><option value="lease_up">Lease-Up</option><option value="distressed">Distressed</option>
            </select></label>
        </Section>

        <Section title="Lien Information">
          <Num label="Existing First Lien Amount" value={form.existingFirstLienAmount} onChange={v => set('existingFirstLienAmount', v)} />
          <Txt label="Other Liens (if any)" value={form.otherLiens} onChange={v => set('otherLiens', v)} />
          <Txt label="Current Lienholder(s)" value={form.currentLienholders} onChange={v => set('currentLienholders', v)} />
        </Section>

        <Section title="Project Information">
          <Area label="Executive Summary (transaction, business plan, why financing is required)" value={form.executiveSummary} onChange={v => set('executiveSummary', v)} />
          <Area label="Funding sources approached in the last 6 months" value={form.fundingSourcesApproached} onChange={v => set('fundingSourcesApproached', v)} />
          <Area label="Reasons the transaction has not yet closed / key blockers" value={form.reasonsNotClosed} onChange={v => set('reasonsNotClosed', v)} />
        </Section>

        <Section title="Capital Stack">
          <Num label="Total Project Cost" value={form.totalProjectCost} onChange={v => set('totalProjectCost', v)} />
          <Num label="Equity Invested to Date" value={form.equityInvestedToDate} onChange={v => set('equityInvestedToDate', v)} />
          <Num label="Remaining Equity to Fund" value={form.remainingEquityToFund} onChange={v => set('remainingEquityToFund', v)} />
          <Num label="Requested Senior Loan Amount" value={form.requestedSeniorLoanAmount} onChange={v => set('requestedSeniorLoanAmount', v)} />
        </Section>

        <Section title="Representation">
          <YesNo label="Working with another broker or advisor on this transaction?" value={form.workingWithOtherBroker} onChange={v => set('workingWithOtherBroker', v)} />
          {form.workingWithOtherBroker && <Txt label="Name & role" value={form.otherBrokerNameRole} onChange={v => set('otherBrokerNameRole', v)} />}
        </Section>

        <Section title="Borrower Information & Experience">
          <Txt label="Name of Borrowing Entity" value={form.borrowingEntityName} onChange={v => set('borrowingEntityName', v)} />
          <Txt label="Project Name" value={form.projectName} onChange={v => set('projectName', v)} />
          <Txt label="Project Address" value={form.projectAddress} onChange={v => set('projectAddress', v)} />
          <Txt label="Property Type" value={form.propertyTypeText} onChange={v => set('propertyTypeText', v)} />
          <Area label="Property Description" value={form.propertyDescription} onChange={v => set('propertyDescription', v)} />
          <Txt label="Business Type (if applicable)" value={form.businessType} onChange={v => set('businessType', v)} />
          <Num label="Number of similar assets owned/operated" value={form.numSimilarAssets} onChange={v => set('numSimilarAssets', v)} />
          <Txt label="Total portfolio size (units / SF / value)" value={form.totalPortfolioSize} onChange={v => set('totalPortfolioSize', v)} />
          <Num label="Years of operating experience" value={form.yearsOperatingExperience} onChange={v => set('yearsOperatingExperience', v)} />
          <label className="block text-sm"><span className="text-gray-600">Sponsor Experience</span>
            <select value={form.sponsorExperience ?? ''} onChange={e => set('sponsorExperience', (e.target.value || null) as CommercialIntake['sponsorExperience'])} className={`${ic} mt-1`}>
              <option value="">—</option><option value="first_time">First-time sponsor</option><option value="experienced">Experienced operator</option><option value="institutional">Institutional sponsor</option>
            </select></label>
        </Section>

        <Section title="Purchase Details (if applicable)">
          <Num label="Purchase Price" value={form.purchasePrice} onChange={v => set('purchasePrice', v)} />
          <Num label="Seller Credit" value={form.sellerCredit} onChange={v => set('sellerCredit', v)} />
          <Num label="Cash Equity / Down Payment" value={form.cashEquityDownPayment} onChange={v => set('cashEquityDownPayment', v)} />
          <Num label="Requested Loan Amount" value={form.purchaseRequestedLoanAmount} onChange={v => set('purchaseRequestedLoanAmount', v)} />
          <Txt label="Source of Equity" value={form.sourceOfEquity} onChange={v => set('sourceOfEquity', v)} />
          <Txt label="Deferred Maintenance" value={form.purchaseDeferredMaintenance} onChange={v => set('purchaseDeferredMaintenance', v)} />
          <Txt label="Date Needed to Close" value={form.purchaseDateNeededToClose} onChange={v => set('purchaseDateNeededToClose', v)} />
        </Section>

        <Section title="Refinance Details (if applicable)">
          <Num label="Requested Loan Amount" value={form.refiRequestedLoanAmount} onChange={v => set('refiRequestedLoanAmount', v)} />
          <Num label="Estimated Property Value" value={form.refiEstimatedValue} onChange={v => set('refiEstimatedValue', v)} />
          <Txt label="Original Acquisition Date" value={form.originalAcquisitionDate} onChange={v => set('originalAcquisitionDate', v)} />
          <Num label="Original Cost" value={form.originalCost} onChange={v => set('originalCost', v)} />
          <Num label="Existing Debt Balance" value={form.existingDebtBalance} onChange={v => set('existingDebtBalance', v)} />
          <Txt label="Current Lender" value={form.currentLender} onChange={v => set('currentLender', v)} />
          <Txt label="Loan Status (explain if in default)" value={form.loanStatus} onChange={v => set('loanStatus', v)} />
          <Txt label="Use of Funds" value={form.useOfFunds} onChange={v => set('useOfFunds', v)} />
          <Txt label="Deferred Maintenance" value={form.refiDeferredMaintenance} onChange={v => set('refiDeferredMaintenance', v)} />
          <Txt label="Date Needed to Close" value={form.refiDateNeededToClose} onChange={v => set('refiDateNeededToClose', v)} />
        </Section>

        <Section title="Construction (if applicable)">
          <Num label="As-Is Value" value={form.asIsValue} onChange={v => set('asIsValue', v)} />
          <Num label="As-Completed Value" value={form.asCompletedValue} onChange={v => set('asCompletedValue', v)} />
          <Num label="Cost to Complete" value={form.costToComplete} onChange={v => set('costToComplete', v)} />
        </Section>

        <Section title="Income Overview">
          <Txt label="2023 Gross Revenue / NOI" value={form.grossRevenue2023} onChange={v => set('grossRevenue2023', v)} />
          <Txt label="2024 Gross Revenue / NOI" value={form.grossRevenue2024} onChange={v => set('grossRevenue2024', v)} />
          <Txt label="2025 Gross Revenue / NOI" value={form.grossRevenue2025} onChange={v => set('grossRevenue2025', v)} />
          <Txt label="YTD Gross Revenue / NOI" value={form.grossRevenueYtd} onChange={v => set('grossRevenueYtd', v)} />
          <Txt label="Current Occupancy" value={form.currentOccupancy} onChange={v => set('currentOccupancy', v)} />
          <Txt label="Loan Amount per SF" value={form.loanAmountPerSf} onChange={v => set('loanAmountPerSf', v)} />
          <Txt label="Forecast DSCR (Proposed Loan)" value={form.forecastDscr} onChange={v => set('forecastDscr', v)} />
        </Section>

        <Section title="Hotel-Specific (if applicable)">
          <Num label="Number of Rooms" value={form.hotelNumberOfRooms} onChange={v => set('hotelNumberOfRooms', v)} />
          <Txt label="Loan Amount per Key" value={form.hotelLoanPerKey} onChange={v => set('hotelLoanPerKey', v)} />
          <Txt label="Forecast DSCR" value={form.hotelForecastDscr} onChange={v => set('hotelForecastDscr', v)} />
        </Section>

        <Section title="Principal Information">
          <YesNo label="Any bankruptcies, foreclosures, or major credit events in the past 7 years?" value={form.hadCreditEvents} onChange={v => set('hadCreditEvents', v)} />
          {form.hadCreditEvents && <Txt label="Please explain" value={form.creditEventsExplain} onChange={v => set('creditEventsExplain', v)} />}
          {form.principals.map((p, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Principal #{i + 1}</span>
                {form.principals.length > 1 && (
                  <button type="button" onClick={() => set('principals', form.principals.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                )}
              </div>
              <div className="space-y-2">
                <Txt label="Name" value={p.name} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, name: v } : x))} />
                <Txt label="Address" value={p.address} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, address: v } : x))} />
                <div className="grid grid-cols-2 gap-2">
                  <Txt label="Phone (Office)" value={p.phoneOffice} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, phoneOffice: v } : x))} />
                  <Txt label="Phone (Cell)" value={p.phoneCell} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, phoneCell: v } : x))} />
                </div>
                <Txt label="Email" value={p.email} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, email: v } : x))} />
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Current Liquidity" value={p.currentLiquidity} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, currentLiquidity: v } : x))} />
                  <Num label="Net Worth (excl. subject)" value={p.netWorthExclSubject} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, netWorthExclSubject: v } : x))} />
                  <Num label="Ownership %" value={p.ownershipPct} onChange={v => set('principals', form.principals.map((x, j) => j === i ? { ...x, ownershipPct: v } : x))} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set('principals', [...form.principals, emptyCommercialPrincipal()])} className="flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700">
            <Plus className="w-4 h-4" /> Add principal
          </button>
        </Section>

        <Section title="Supporting Documents">
          <p className="text-xs text-gray-500">Check the documents you can provide — you'll upload them in the Documents tab.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {SUPPORTING_DOCUMENTS.map(d => (
              <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.supportingDocs.includes(d)} onChange={() => toggleArr('supportingDocs', d)} className="rounded text-teal-600" /> {d}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Exit Strategy / Repayment Plan">
          <Txt label="Refinance / Hold / Sale (please specify)" value={form.exitStrategy} onChange={v => set('exitStrategy', v)} />
          <Area label="If sale, broker and marketing strategy" value={form.saleBrokerStrategy} onChange={v => set('saleBrokerStrategy', v)} />
        </Section>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-3 pb-10">
          <button onClick={() => navigate('/application/new-loan')} className="px-4 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving || !borrowerId} className="px-6 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit Commercial Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
