import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import {
  DECLARATIONS_5A, DECLARATIONS_5B, PRIOR_PROPERTY_TYPE_OPTIONS, PRIOR_TITLE_OPTIONS,
  BANKRUPTCY_TYPES, HMDA_ETHNICITY, HMDA_RACE, HMDA_SEX,
  ASSET_TYPES, LIABILITY_TYPES, REO_STATUS, REO_OCCUPANCY,
  emptyDeclarations, emptyMilitary, emptyDemographic,
  emptyEmployment, emptyOtherIncome, emptyAsset, emptyLiability, emptyRealEstate,
  type Urla1003Declarations, type Urla1003Military, type Urla1003Demographic, type YesNo,
  type Urla1003Employment, type Urla1003OtherIncome, type Urla1003Asset,
  type Urla1003Liability, type Urla1003RealEstate,
} from '../../shared/urla1003Details';

interface Props {
  borrowerId: string;
  readOnly?: boolean;
  onSaved?: () => void;
}

// Collects URLA 1003 Section 5 (Declarations), Section 7 (Military), and
// Section 8 (Demographic/HMDA). Used in both the borrower portal and the
// broker's borrower-detail page (same fields, same storage on `borrowers`).
export function Urla1003DetailsForm({ borrowerId, readOnly = false, onSaved }: Props) {
  const [declarations, setDeclarations] = useState<Urla1003Declarations>(emptyDeclarations());
  const [military, setMilitary] = useState<Urla1003Military>(emptyMilitary());
  const [demographic, setDemographic] = useState<Urla1003Demographic>(emptyDemographic());
  const [employment, setEmployment] = useState<Urla1003Employment[]>([]);
  const [otherIncome, setOtherIncome] = useState<Urla1003OtherIncome[]>([]);
  const [assets, setAssets] = useState<Urla1003Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Urla1003Liability[]>([]);
  const [realEstate, setRealEstate] = useState<Urla1003RealEstate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('borrowers')
        .select('declarations, demographic_info, military_service, employment, other_income, assets, liabilities, real_estate_owned, urla_details_completed_at')
        .eq('id', borrowerId)
        .maybeSingle();
      if (!active) return;
      if (data?.declarations) setDeclarations({ ...emptyDeclarations(), ...(data.declarations as Urla1003Declarations) });
      if (data?.military_service) setMilitary({ ...emptyMilitary(), ...(data.military_service as Urla1003Military) });
      if (data?.demographic_info) setDemographic({ ...emptyDemographic(), ...(data.demographic_info as Urla1003Demographic) });
      if (Array.isArray(data?.employment)) setEmployment(data.employment as Urla1003Employment[]);
      if (Array.isArray(data?.other_income)) setOtherIncome(data.other_income as Urla1003OtherIncome[]);
      if (Array.isArray(data?.assets)) setAssets(data.assets as Urla1003Asset[]);
      if (Array.isArray(data?.liabilities)) setLiabilities(data.liabilities as Urla1003Liability[]);
      if (Array.isArray(data?.real_estate_owned)) setRealEstate(data.real_estate_owned as Urla1003RealEstate[]);
      setSavedAt((data?.urla_details_completed_at as string) || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [borrowerId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('borrowers')
        .update({
          declarations,
          military_service: military,
          demographic_info: demographic,
          employment,
          other_income: otherIncome,
          assets,
          liabilities,
          real_estate_owned: realEstate,
          urla_details_completed_at: new Date().toISOString(),
        })
        .eq('id', borrowerId);
      if (err) throw err;
      setSavedAt(new Date().toISOString());
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleArray = (arr: string[], v: string): string[] =>
    arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  // ---- small renderers ----
  const YesNoRow = ({ label, value, onChange }: { label: string; value: YesNo; onChange: (v: YesNo) => void }) => (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
      <span className="text-sm text-gray-700 flex-1">{label}</span>
      <div className="flex gap-3 shrink-0">
        {(['yes', 'no'] as const).map(opt => (
          <label key={opt} className={`flex items-center gap-1 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
            <input
              type="radio"
              disabled={readOnly}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="text-teal-600 focus:ring-teal-500"
            />
            <span className="capitalize">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const CheckGroup = ({ options, selected, onToggle }: { options: readonly string[]; selected: string[]; onToggle: (v: string) => void }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      {options.map(o => (
        <label key={o} className={`flex items-center gap-2 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
          <input type="checkbox" disabled={readOnly} checked={selected.includes(o)} onChange={() => onToggle(o)} className="rounded text-teal-600 focus:ring-teal-500" />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );

  // Generic text/number input + select for the repeatable list rows.
  const inputCls = 'w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50';
  const Txt = ({ label, value, onChange, ph }: { label: string; value: string; onChange: (v: string) => void; ph?: string }) => (
    <label className="text-xs text-gray-500 block">{label}
      <input type="text" disabled={readOnly} value={value} placeholder={ph} onChange={e => onChange(e.target.value)} className={`${inputCls} mt-0.5`} />
    </label>
  );
  const Num = ({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) => (
    <label className="text-xs text-gray-500 block">{label}
      <input type="text" inputMode="decimal" disabled={readOnly} value={value ?? ''} onChange={e => { const d = e.target.value.replace(/[^0-9.]/g, ''); onChange(d === '' ? null : Number(d)); }} className={`${inputCls} mt-0.5`} />
    </label>
  );
  const Sel = ({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) => (
    <label className="text-xs text-gray-500 block">{label}
      <select disabled={readOnly} value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} mt-0.5`}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
  // Repeatable-section wrapper with Add / Remove controls.
  function ListSection<T>({ title, items, setItems, makeEmpty, addLabel, render }: {
    title: string; items: T[]; setItems: (v: T[]) => void; makeEmpty: () => T; addLabel: string;
    render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
  }) {
    return (
      <section>
        <h4 className="font-semibold text-gray-900 mb-2">{title}</h4>
        {items.length === 0 && <p className="text-sm text-gray-400 mb-2">None added.</p>}
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 relative">
              {!readOnly && (
                <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-gray-400 hover:text-red-600 text-xs">Remove</button>
              )}
              {render(item, (patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it))))}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button type="button" onClick={() => setItems([...items, makeEmpty()])} className="mt-2 text-sm font-medium text-teal-600 hover:text-teal-700">+ {addLabel}</button>
        )}
      </section>
    );
  }

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Section 5 — Declarations */}
      <section>
        <h4 className="font-semibold text-gray-900 mb-1">Section 5: Declarations</h4>
        <p className="text-xs text-gray-500 mb-3">5a. About this property and your money for this loan</p>
        {DECLARATIONS_5A.map(q => (
          <div key={q.key}>
            <YesNoRow label={q.label} value={declarations[q.key] as YesNo} onChange={v => setDeclarations(d => ({ ...d, [q.key]: v }))} />
            {q.key === 'ownedLast3Yrs' && declarations.ownedLast3Yrs === 'yes' && (
              <div className="pl-4 py-2 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 rounded-lg my-1">
                <label className="text-sm text-gray-600">
                  C. Property type
                  <select disabled={readOnly} value={declarations.priorPropertyType ?? ''} onChange={e => setDeclarations(d => ({ ...d, priorPropertyType: (e.target.value || null) as Urla1003Declarations['priorPropertyType'] }))} className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded text-sm">
                    <option value="">—</option>
                    {PRIOR_PROPERTY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="text-sm text-gray-600">
                  D. How did you hold title?
                  <select disabled={readOnly} value={declarations.priorTitleHeld ?? ''} onChange={e => setDeclarations(d => ({ ...d, priorTitleHeld: (e.target.value || null) as Urla1003Declarations['priorTitleHeld'] }))} className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded text-sm">
                    <option value="">—</option>
                    {PRIOR_TITLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        ))}

        <p className="text-xs text-gray-500 mt-4 mb-2">5b. About your finances</p>
        {DECLARATIONS_5B.map(q => (
          <div key={q.key}>
            <YesNoRow label={q.label} value={declarations[q.key] as YesNo} onChange={v => setDeclarations(d => ({ ...d, [q.key]: v }))} />
            {q.key === 'bankruptcy' && declarations.bankruptcy === 'yes' && (
              <div className="pl-4 py-2 bg-gray-50 rounded-lg my-1">
                <span className="text-sm text-gray-600">Bankruptcy type(s):</span>
                <CheckGroup options={BANKRUPTCY_TYPES} selected={declarations.bankruptcyTypes} onToggle={v => setDeclarations(d => ({ ...d, bankruptcyTypes: toggleArray(d.bankruptcyTypes, v) }))} />
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Section 7 — Military */}
      <section>
        <h4 className="font-semibold text-gray-900 mb-2">Section 7: Military Service</h4>
        <YesNoRow
          label="Did you (or your deceased spouse) ever serve, or are you currently serving, in the U.S. Armed Forces?"
          value={military.servedOrServing}
          onChange={v => setMilitary(m => ({ ...m, servedOrServing: v }))}
        />
        {military.servedOrServing === 'yes' && (
          <div className="pl-4 py-2 space-y-1.5 bg-gray-50 rounded-lg mt-1">
            {([
              ['currentlyActiveDuty', 'Currently serving on active duty'],
              ['retiredDischargedSeparated', 'Currently retired, discharged, or separated from service'],
              ['nonActivatedReserveGuard', 'Only period of service was as a non-activated member of the Reserve or National Guard'],
              ['survivingSpouse', 'Surviving spouse'],
            ] as const).map(([k, label]) => (
              <label key={k} className={`flex items-center gap-2 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="checkbox" disabled={readOnly} checked={military[k]} onChange={e => setMilitary(m => ({ ...m, [k]: e.target.checked }))} className="rounded text-teal-600 focus:ring-teal-500" />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Section 8 — Demographic / HMDA */}
      <section>
        <h4 className="font-semibold text-gray-900 mb-1">Section 8: Demographic Information</h4>
        <p className="text-xs text-gray-500 mb-3">
          The law requires we ask for this to monitor compliance with fair lending laws. You are not required to provide it.
        </p>

        <div className="mb-3">
          <span className="text-sm font-medium text-gray-700">Ethnicity</span>
          <CheckGroup options={HMDA_ETHNICITY} selected={demographic.ethnicity} onToggle={v => setDemographic(d => ({ ...d, ethnicity: toggleArray(d.ethnicity, v) }))} />
          <label className={`flex items-center gap-2 text-sm mt-2 ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
            <input type="checkbox" disabled={readOnly} checked={demographic.ethnicityDoNotWish} onChange={e => setDemographic(d => ({ ...d, ethnicityDoNotWish: e.target.checked }))} className="rounded text-teal-600 focus:ring-teal-500" />
            <span>I do not wish to provide this information</span>
          </label>
        </div>

        <div className="mb-3">
          <span className="text-sm font-medium text-gray-700">Race</span>
          <CheckGroup options={HMDA_RACE} selected={demographic.race} onToggle={v => setDemographic(d => ({ ...d, race: toggleArray(d.race, v) }))} />
          <label className={`flex items-center gap-2 text-sm mt-2 ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
            <input type="checkbox" disabled={readOnly} checked={demographic.raceDoNotWish} onChange={e => setDemographic(d => ({ ...d, raceDoNotWish: e.target.checked }))} className="rounded text-teal-600 focus:ring-teal-500" />
            <span>I do not wish to provide this information</span>
          </label>
        </div>

        <div>
          <span className="text-sm font-medium text-gray-700">Sex</span>
          <div className="flex gap-4 mt-2">
            {HMDA_SEX.map(s => (
              <label key={s} className={`flex items-center gap-1.5 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="radio" disabled={readOnly} checked={demographic.sex === s} onChange={() => setDemographic(d => ({ ...d, sex: s }))} className="text-teal-600 focus:ring-teal-500" />
                <span>{s}</span>
              </label>
            ))}
            <label className={`flex items-center gap-1.5 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="checkbox" disabled={readOnly} checked={demographic.sexDoNotWish} onChange={e => setDemographic(d => ({ ...d, sexDoNotWish: e.target.checked }))} className="rounded text-teal-600 focus:ring-teal-500" />
              <span>I do not wish to provide</span>
            </label>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-200 pt-2">
        <p className="text-xs text-gray-400">The sections below are optional — add as much as you can to complete your 1003.</p>
      </div>

      {/* Section 1b–1d — Employment */}
      <ListSection<Urla1003Employment>
        title="Employment & Income (Section 1b–1d)"
        items={employment} setItems={setEmployment} makeEmpty={() => emptyEmployment('current')} addLabel="Add employer"
        render={(e, update) => (
          <div className="space-y-2">
            <Sel label="Type" value={e.kind} options={['current', 'additional', 'previous']} onChange={v => update({ kind: (v || 'current') as Urla1003Employment['kind'] })} />
            <div className="grid grid-cols-2 gap-2">
              <Txt label="Employer / Business Name" value={e.employerName} onChange={v => update({ employerName: v })} />
              <Txt label="Phone" value={e.phone} onChange={v => update({ phone: v })} />
            </div>
            <Txt label="Street" value={e.street} onChange={v => update({ street: v })} />
            <div className="grid grid-cols-3 gap-2">
              <Txt label="City" value={e.city} onChange={v => update({ city: v })} />
              <Txt label="State" value={e.state} onChange={v => update({ state: v })} />
              <Txt label="ZIP" value={e.zip} onChange={v => update({ zip: v })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Txt label="Position / Title" value={e.position} onChange={v => update({ position: v })} />
              <Txt label="Start Date (mm/yyyy)" value={e.startDate} onChange={v => update({ startDate: v })} />
              <Num label="Yrs in line of work" value={e.yearsInLineOfWork} onChange={v => update({ yearsInLineOfWork: v })} />
            </div>
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}><input type="checkbox" disabled={readOnly} checked={e.selfEmployed} onChange={ev => update({ selfEmployed: ev.target.checked })} className="rounded text-teal-600" /> Self-employed</label>
              <label className={`flex items-center gap-2 text-sm ${readOnly ? 'opacity-70' : 'cursor-pointer'}`}><input type="checkbox" disabled={readOnly} checked={e.ownership25OrMore} onChange={ev => update({ ownership25OrMore: ev.target.checked })} className="rounded text-teal-600" /> Ownership ≥ 25%</label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Base ($/mo)" value={e.monthlyBase} onChange={v => update({ monthlyBase: v })} />
              <Num label="Overtime" value={e.monthlyOvertime} onChange={v => update({ monthlyOvertime: v })} />
              <Num label="Bonus" value={e.monthlyBonus} onChange={v => update({ monthlyBonus: v })} />
              <Num label="Commission" value={e.monthlyCommission} onChange={v => update({ monthlyCommission: v })} />
              <Num label="Other" value={e.monthlyOther} onChange={v => update({ monthlyOther: v })} />
            </div>
          </div>
        )}
      />

      {/* Section 1e — Other income */}
      <ListSection<Urla1003OtherIncome>
        title="Other Income (Section 1e)"
        items={otherIncome} setItems={setOtherIncome} makeEmpty={emptyOtherIncome} addLabel="Add income source"
        render={(o, update) => (
          <div className="grid grid-cols-2 gap-2">
            <Txt label="Source (rental, alimony, SS, etc.)" value={o.source} onChange={v => update({ source: v })} />
            <Num label="Monthly amount" value={o.monthlyAmount} onChange={v => update({ monthlyAmount: v })} />
          </div>
        )}
      />

      {/* Section 2a/2b — Assets */}
      <ListSection<Urla1003Asset>
        title="Assets (Section 2a/2b)"
        items={assets} setItems={setAssets} makeEmpty={emptyAsset} addLabel="Add asset"
        render={(a, update) => (
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Account Type" value={a.accountType} options={ASSET_TYPES} onChange={v => update({ accountType: v })} />
            <Txt label="Institution" value={a.institution} onChange={v => update({ institution: v })} />
            <Txt label="Account #" value={a.accountNumber} onChange={v => update({ accountNumber: v })} />
            <Num label="Value" value={a.value} onChange={v => update({ value: v })} />
          </div>
        )}
      />

      {/* Section 2c/2d — Liabilities */}
      <ListSection<Urla1003Liability>
        title="Liabilities (Section 2c/2d)"
        items={liabilities} setItems={setLiabilities} makeEmpty={emptyLiability} addLabel="Add liability"
        render={(l, update) => (
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Type" value={l.accountType} options={LIABILITY_TYPES} onChange={v => update({ accountType: v })} />
            <Txt label="Company" value={l.company} onChange={v => update({ company: v })} />
            <Txt label="Account #" value={l.accountNumber} onChange={v => update({ accountNumber: v })} />
            <Num label="Unpaid Balance" value={l.unpaidBalance} onChange={v => update({ unpaidBalance: v })} />
            <Num label="Monthly Payment" value={l.monthlyPayment} onChange={v => update({ monthlyPayment: v })} />
          </div>
        )}
      />

      {/* Section 3 — Real Estate Owned */}
      <ListSection<Urla1003RealEstate>
        title="Real Estate Owned (Section 3)"
        items={realEstate} setItems={setRealEstate} makeEmpty={emptyRealEstate} addLabel="Add property"
        render={(r, update) => (
          <div className="space-y-2">
            <Txt label="Property Address" value={r.address} onChange={v => update({ address: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Sel label="Status" value={r.status} options={REO_STATUS} onChange={v => update({ status: v })} />
              <Sel label="Occupancy" value={r.occupancy} options={REO_OCCUPANCY} onChange={v => update({ occupancy: v })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Value" value={r.value} onChange={v => update({ value: v })} />
              <Num label="Taxes/Ins/HOA ($/mo)" value={r.monthlyTaxesInsHoa} onChange={v => update({ monthlyTaxesInsHoa: v })} />
              <Num label="Mortgage Balance" value={r.mortgageBalance} onChange={v => update({ mortgageBalance: v })} />
              <Num label="Mortgage Payment ($/mo)" value={r.monthlyMortgage} onChange={v => update({ monthlyMortgage: v })} />
              <Num label="Gross Rent ($/mo)" value={r.grossRentalIncome} onChange={v => update({ grossRentalIncome: v })} />
            </div>
          </div>
        )}
      />

      {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>}

      {!readOnly && (
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save 1003 Details'}
          </button>
          {savedAt && <span className="text-xs text-gray-500">Last saved {new Date(savedAt).toLocaleString()}</span>}
        </div>
      )}
      {readOnly && savedAt && <p className="text-xs text-gray-500">Completed {new Date(savedAt).toLocaleString()}</p>}
    </div>
  );
}
