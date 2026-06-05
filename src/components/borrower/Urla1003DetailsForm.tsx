import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  DECLARATIONS_5A, DECLARATIONS_5B, PRIOR_PROPERTY_TYPE_OPTIONS, PRIOR_TITLE_OPTIONS,
  BANKRUPTCY_TYPES, HMDA_ETHNICITY, HMDA_RACE, HMDA_SEX,
  emptyDeclarations, emptyMilitary, emptyDemographic,
  type Urla1003Declarations, type Urla1003Military, type Urla1003Demographic, type YesNo,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('borrowers')
        .select('declarations, demographic_info, military_service, urla_details_completed_at')
        .eq('id', borrowerId)
        .maybeSingle();
      if (!active) return;
      if (data?.declarations) setDeclarations({ ...emptyDeclarations(), ...(data.declarations as Urla1003Declarations) });
      if (data?.military_service) setMilitary({ ...emptyMilitary(), ...(data.military_service as Urla1003Military) });
      if (data?.demographic_info) setDemographic({ ...emptyDemographic(), ...(data.demographic_info as Urla1003Demographic) });
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
