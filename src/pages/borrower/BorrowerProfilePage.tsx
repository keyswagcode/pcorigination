import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower } from '../../shared/types';
import { User, Building2, Save, Loader2, CheckCircle, FileText } from 'lucide-react';

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

      const borrowerData = {
        ...borrower,
        user_id: user!.id,
        borrower_status: borrower.borrower_status || 'draft',
        lifecycle_stage: lifecycleStage
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
        navigate('/borrower/dashboard');
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                State of Residence
              </label>
              <select
                value={borrower.state_of_residence || ''}
                onChange={e => setBorrower({ ...borrower, state_of_residence: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Select state</option>
                {US_STATES.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
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

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/borrower/dashboard')}
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
