import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower } from '../../shared/types';
import { User, Building2, Save, Loader2, CheckCircle, FileText, UserPlus, Trash2, Send, Eye, EyeOff, Shield } from 'lucide-react';

const LOAN_TYPES = [
  { value: 'bank_statement', label: 'Bank Statement', description: 'Use bank deposits to qualify instead of tax returns' },
  { value: 'dscr', label: 'DSCR', description: 'Qualify based on rental income covering the mortgage' },
  { value: 'fix_flip', label: 'Fix & Flip', description: 'Short-term financing for property renovation projects' },
  { value: 'not_sure', label: 'Not Sure', description: "We'll help you find the best option" },
];

const ENTITY_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'trust', label: 'Trust' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export function BorrowerProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSsn, setShowSsn] = useState(false);
  const [ssnInput, setSsnInput] = useState('');

  const formatSsnDisplay = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };
  const [borrower, setBorrower] = useState<Partial<Borrower & { preferred_loan_type: string }>>({
    borrower_name: '',
    email: '',
    phone: '',
    entity_type: 'individual',
    state_of_residence: '',
    credit_score: null,
    real_estate_experience_years: 0,
    properties_owned_count: 0,
    preferred_loan_type: 'not_sure'
  });

  useEffect(() => {
    if (user) {
      loadBorrower();
    }
  }, [user]);

  async function loadBorrower() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('borrowers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (data) {
        setBorrower(data);
        const storedSsn = (data as Record<string, unknown>).ssn_encrypted as string | null;
        if (storedSsn) setSsnInput(formatSsnDisplay(storedSsn));
      } else {
        const { data: userAccount } = await supabase
          .from('user_accounts')
          .select('first_name, last_name, email, phone')
          .eq('id', user!.id)
          .maybeSingle();

        if (userAccount) {
          setBorrower(prev => ({
            ...prev,
            borrower_name: `${userAccount.first_name || ''} ${userAccount.last_name || ''}`.trim(),
            email: userAccount.email || '',
            phone: userAccount.phone || ''
          }));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      const lifecycleStage = borrower.preferred_loan_type && borrower.preferred_loan_type !== 'not_sure'
        ? 'loan_type_selected'
        : 'profile_created';

      const ssnDigits = ssnInput.replace(/\D/g, '');
      const borrowerData = {
        ...borrower,
        user_id: user!.id,
        borrower_status: borrower.borrower_status || 'draft',
        lifecycle_stage: lifecycleStage,
        ...(ssnDigits.length === 9 ? {
          ssn_encrypted: ssnDigits,
          ssn_last4: ssnDigits.slice(-4),
        } : {}),
      };

      if (borrower.id) {
        await supabase
          .from('borrowers')
          .update(borrowerData)
          .eq('id', borrower.id);
      } else {
        const { data } = await supabase
          .from('borrowers')
          .insert(borrowerData)
          .select()
          .single();

        if (data) {
          setBorrower(data);
        }
      }

      setSaved(true);
      setTimeout(() => {
        navigate('/application');
      }, 500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Your Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your personal info and co-borrowers</p>
        <p className="text-gray-600 mt-1">
          Complete your profile information to help us match you with the best loan options
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Personal Information</h2>
              <p className="text-sm text-gray-500">Basic contact and identity details</p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={borrower.borrower_name || ''}
                onChange={e => setBorrower({ ...borrower, borrower_name: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter your full legal name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                type="email"
                required
                value={borrower.email || ''}
                onChange={e => setBorrower({ ...borrower, email: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={borrower.phone || ''}
                onChange={e => setBorrower({ ...borrower, phone: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Residential Address
              </label>
              <input
                type="text"
                value={(borrower as Record<string, unknown>).address_street as string || ''}
                onChange={e => setBorrower({ ...borrower, address_street: e.target.value } as typeof borrower)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 mb-2"
                placeholder="Street address"
              />
              <div className="grid grid-cols-6 gap-2">
                <input
                  type="text"
                  value={(borrower as Record<string, unknown>).address_city as string || ''}
                  onChange={e => setBorrower({ ...borrower, address_city: e.target.value } as typeof borrower)}
                  className="col-span-3 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="City"
                />
                <select
                  value={(borrower as Record<string, unknown>).address_state as string || borrower.state_of_residence || ''}
                  onChange={e => setBorrower({ ...borrower, address_state: e.target.value, state_of_residence: e.target.value } as typeof borrower)}
                  className="col-span-1 px-2 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">ST</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={(borrower as Record<string, unknown>).address_zip as string || ''}
                  onChange={e => setBorrower({ ...borrower, address_zip: e.target.value.replace(/\D/g, '').slice(0, 5) } as typeof borrower)}
                  className="col-span-2 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="Zip"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Credit Score *
              </label>
              <input
                type="number"
                required
                min="300"
                max="850"
                value={borrower.credit_score || ''}
                onChange={e => setBorrower({ ...borrower, credit_score: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Enter your credit score (300-850)"
              />
              <p className="text-xs text-gray-500 mt-1">
                Your approximate FICO score
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date of Birth
              </label>
              <input
                type="date"
                value={(borrower as Record<string, unknown>).date_of_birth as string || ''}
                onChange={e => setBorrower({ ...borrower, date_of_birth: e.target.value } as typeof borrower)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Social Security Number
              </label>
              <div className="relative">
                <input
                  type={showSsn ? 'text' : 'password'}
                  value={ssnInput}
                  onChange={e => setSsnInput(formatSsnDisplay(e.target.value))}
                  className="w-full px-4 py-2.5 pr-20 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono"
                  placeholder="XXX-XX-XXXX"
                  autoComplete="off"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSsn(!showSsn)}
                    className="p-1 text-gray-400 hover:text-teal-600 transition-colors"
                    title={showSsn ? 'Hide SSN' : 'Show SSN'}
                  >
                    {showSsn ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <Shield className="w-4 h-4 text-teal-500" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Encrypted and used only for identity verification with our credit partners.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Loan Type</h2>
              <p className="text-sm text-gray-500">What type of loan are you looking for?</p>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {LOAN_TYPES.map(type => (
                <label
                  key={type.value}
                  className={`relative flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    borrower.preferred_loan_type === type.value
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="loan_type"
                    value={type.value}
                    checked={borrower.preferred_loan_type === type.value}
                    onChange={e => setBorrower({ ...borrower, preferred_loan_type: e.target.value })}
                    className="sr-only"
                  />
                  <div className="flex-1">
                    <span className={`block font-medium ${
                      borrower.preferred_loan_type === type.value ? 'text-teal-900' : 'text-gray-900'
                    }`}>
                      {type.label}
                    </span>
                    <span className={`block text-sm mt-0.5 ${
                      borrower.preferred_loan_type === type.value ? 'text-teal-700' : 'text-gray-500'
                    }`}>
                      {type.description}
                    </span>
                  </div>
                  {borrower.preferred_loan_type === type.value && (
                    <div className="ml-3 flex-shrink-0">
                      <CheckCircle className="w-5 h-5 text-teal-600" />
                    </div>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Entity & Experience</h2>
              <p className="text-sm text-gray-500">Your borrowing entity and real estate background</p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entity Type
              </label>
              <select
                value={borrower.entity_type || 'individual'}
                onChange={e => setBorrower({ ...borrower, entity_type: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {ENTITY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Real Estate Experience (Years)
              </label>
              <input
                type="number"
                min="0"
                value={borrower.real_estate_experience_years || 0}
                onChange={e => setBorrower({ ...borrower, real_estate_experience_years: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Properties Currently Owned
              </label>
              <input
                type="number"
                min="0"
                value={borrower.properties_owned_count || 0}
                onChange={e => setBorrower({ ...borrower, properties_owned_count: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Portfolio Value ($)
              </label>
              <input
                type="number"
                min="0"
                value={borrower.portfolio_value || ''}
                onChange={e => setBorrower({ ...borrower, portfolio_value: e.target.value ? parseFloat(e.target.value) : null })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Estimated total portfolio value"
              />
            </div>
          </div>
        </div>

        {/* Co-Borrower Section */}
        {borrower.id && <CoBorrowerSection borrowerId={borrower.id} />}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/application')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved
              </>
            ) : borrower.id ? (
              <>
                <Save className="w-4 h-4" />
                Save & Continue
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save & Start Journey
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================
// Co-Borrower Section Component
// ============================================

interface CoBorrower {
  id: string;
  borrower_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  ssn_last4: string | null;
  ssn_encrypted: string | null;
  credit_score: number | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  status: string;
  filled_by_self: boolean;
}

const EMPTY_COBORROWER = {
  borrower_name: '',
  email: '',
  phone: '',
  date_of_birth: '',
  ssn_encrypted: '',
  credit_score: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
};

function CoBorrowerSection({ borrowerId }: { borrowerId: string }) {
  const [coBorrowers, setCoBorrowers] = useState<CoBorrower[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'manual' | 'invite'>('manual');
  const [form, setForm] = useState(EMPTY_COBORROWER);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCoBorrowers = useCallback(async () => {
    const { data } = await supabase
      .from('co_borrowers')
      .select('*')
      .eq('borrower_id', borrowerId)
      .order('created_at', { ascending: true });
    setCoBorrowers(data || []);
  }, [borrowerId]);

  useEffect(() => { loadCoBorrowers(); }, [loadCoBorrowers]);

  const formatSSN = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handleManualAdd = async () => {
    if (!form.borrower_name) return;
    setSaving(true);
    setError(null);

    try {
      const ssnDigits = form.ssn_encrypted.replace(/\D/g, '');
      const { error: insertError } = await supabase.from('co_borrowers').insert({
        borrower_id: borrowerId,
        borrower_name: form.borrower_name,
        email: form.email || null,
        phone: form.phone.replace(/\D/g, '') || null,
        date_of_birth: form.date_of_birth || null,
        ssn_last4: ssnDigits.slice(-4) || null,
        ssn_encrypted: ssnDigits || null,
        credit_score: form.credit_score ? parseInt(form.credit_score) : null,
        address_street: form.address_street || null,
        address_city: form.address_city || null,
        address_state: form.address_state || null,
        address_zip: form.address_zip || null,
        status: 'completed',
        filled_by_self: false,
      });
      if (insertError) throw insertError;

      setForm(EMPTY_COBORROWER);
      setShowForm(false);
      await loadCoBorrowers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add co-borrower');
    } finally {
      setSaving(false);
    }
  };

  const callInviteFunction = async (payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/co-borrower-invite`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'send', ...payload }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send invite');
    return data;
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName) return;
    setSaving(true);
    setError(null);

    try {
      await callInviteFunction({
        co_borrower_name: inviteName,
        co_borrower_email: inviteEmail,
      });

      setInviteEmail('');
      setInviteName('');
      setShowForm(false);
      await loadCoBorrowers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  const handleResendInvite = async (cb: CoBorrower) => {
    setSaving(true);
    setError(null);
    try {
      await callInviteFunction({
        co_borrower_id: cb.id,
        co_borrower_name: cb.borrower_name,
        co_borrower_email: cb.email,
      });
      await loadCoBorrowers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invite');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('co_borrowers').delete().eq('id', id);
    await loadCoBorrowers();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Co-Borrowers</h2>
            <p className="text-sm text-gray-500">Add a co-borrower or guarantor to your application</p>
          </div>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Co-Borrower
          </button>
        )}
      </div>

      {/* Existing co-borrowers */}
      {coBorrowers.length > 0 && (
        <div className="divide-y divide-gray-100">
          {coBorrowers.map(cb => (
            <div key={cb.id} className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{cb.borrower_name}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {cb.email && <span>{cb.email}</span>}
                    {cb.credit_score && <span>CS: {cb.credit_score}</span>}
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                      cb.status === 'completed' ? 'bg-green-100 text-green-700' :
                      cb.status === 'invited' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {cb.status === 'completed' ? 'Complete' : cb.status === 'invited' ? 'Invited' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {cb.status === 'invited' && (
                  <button
                    type="button"
                    onClick={() => handleResendInvite(cb)}
                    disabled={saving}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Resend
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(cb.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="p-6 border-t border-gray-200">
          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setFormMode('manual')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                formMode === 'manual' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Fill In Manually
            </button>
            <button
              type="button"
              onClick={() => setFormMode('invite')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                formMode === 'invite' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Send Invite Link
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {formMode === 'manual' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                  <input type="text" value={form.borrower_name} onChange={e => setForm({ ...form, borrower_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Jane Doe" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="jane@email.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cell Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: formatPhone(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="(555) 123-4567" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
                  <input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SSN</label>
                  <input type="text" value={formatSSN(form.ssn_encrypted)} onChange={e => setForm({ ...form, ssn_encrypted: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="XXX-XX-XXXX" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Credit Score</label>
                  <input type="number" value={form.credit_score} onChange={e => setForm({ ...form, credit_score: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="720" min={300} max={850} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                <input type="text" value={form.address_street} onChange={e => setForm({ ...form, address_street: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 mb-2" placeholder="123 Main St" />
                <div className="grid grid-cols-6 gap-2">
                  <input type="text" value={form.address_city} onChange={e => setForm({ ...form, address_city: e.target.value })}
                    className="col-span-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="City" />
                  <select value={form.address_state} onChange={e => setForm({ ...form, address_state: e.target.value })}
                    className="col-span-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600">
                    <option value="">ST</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input type="text" value={form.address_zip} onChange={e => setForm({ ...form, address_zip: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                    className="col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Zip" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setForm(EMPTY_COBORROWER); setError(null); }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
                <button type="button" onClick={handleManualAdd} disabled={saving || !form.borrower_name}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Add Co-Borrower
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Send an invite link so the co-borrower can fill out their own information.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Co-Borrower Name *</label>
                  <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Jane Doe" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                  <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="jane@email.com" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setInviteEmail(''); setInviteName(''); setError(null); }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
                <button type="button" onClick={handleInvite} disabled={saving || !inviteEmail || !inviteName}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send Invite
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {coBorrowers.length === 0 && !showForm && (
        <div className="px-6 py-8 text-center">
          <UserPlus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No co-borrowers added yet</p>
        </div>
      )}
    </div>
  );
}
