import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower } from '../../shared/types';
import {
  Building2,
  MapPin,
  DollarSign,
  Save,
  Loader2,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';

const LOAN_TYPES = [
  { value: 'dscr', label: 'DSCR Loan' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'conventional', label: 'Conventional' },
  { value: 'fix_flip', label: 'Fix & Flip' },
  { value: 'bridge', label: 'Bridge Loan' },
];

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'multi_family', label: 'Multi-Family (2-4 units)' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'commercial', label: 'Commercial' },
];

const OCCUPANCY_TYPES = [
  { value: 'investment', label: 'Investment Property' },
  { value: 'primary', label: 'Primary Residence' },
  { value: 'secondary', label: 'Second Home' },
];

const LOAN_PURPOSES = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'refinance', label: 'Refinance' },
  { value: 'cash_out', label: 'Cash-Out Refinance' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export function BorrowerScenarioCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    scenario_name: '',
    loan_type: 'dscr',
    property_address: '',
    property_city: '',
    property_state: '',
    property_zip: '',
    property_type: 'single_family',
    occupancy: 'investment',
    purchase_price: '',
    estimated_value: '',
    loan_amount: '',
    rent: '',
    loan_purpose: 'purchase'
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

      setBorrower(data);

      if (data && data.borrower_status !== 'approved' && data.borrower_status !== 'conditionally_approved') {
        setError('Your borrower profile must be approved before creating loan scenarios.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!borrower) return;

    setSaving(true);
    setError('');

    try {
      const purchasePrice = form.purchase_price ? parseFloat(form.purchase_price) : null;
      const estimatedValue = form.estimated_value ? parseFloat(form.estimated_value) : purchasePrice;
      const loanAmount = form.loan_amount ? parseFloat(form.loan_amount) : null;

      let ltv = null;
      if (loanAmount && estimatedValue) {
        ltv = (loanAmount / estimatedValue) * 100;
      }

      let dscr = null;
      const rent = form.rent ? parseFloat(form.rent) : null;
      if (rent && loanAmount) {
        const estimatedPayment = (loanAmount * 0.07) / 12;
        dscr = rent / estimatedPayment;
      }

      const { data, error: insertError } = await supabase
        .from('loan_scenarios')
        .insert({
          borrower_id: borrower.id,
          scenario_name: form.scenario_name,
          loan_type: form.loan_type,
          property_address: form.property_address,
          property_city: form.property_city,
          property_state: form.property_state,
          property_zip: form.property_zip,
          property_type: form.property_type,
          occupancy: form.occupancy,
          purchase_price: purchasePrice,
          estimated_value: estimatedValue,
          loan_amount: loanAmount,
          ltv,
          rent,
          dscr,
          loan_purpose: form.loan_purpose,
          status: 'draft'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      navigate(`/borrower/scenarios/${data.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create scenario');
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

  if (!borrower || error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Cannot Create Scenario</h2>
          <p className="text-gray-600 mb-4">{error || 'Profile not found'}</p>
          <Link
            to="/borrower/scenarios"
            className="inline-flex items-center gap-2 text-teal-600 font-medium hover:text-teal-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Scenarios
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          to="/borrower/scenarios"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Scenarios
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">New Loan Scenario</h1>
        <p className="text-gray-600 mt-1">
          Create a property-specific loan scenario to explore financing options
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Scenario Details</h2>
              <p className="text-sm text-gray-500">Basic loan information</p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scenario Name *
              </label>
              <input
                type="text"
                required
                value={form.scenario_name}
                onChange={e => setForm({ ...form, scenario_name: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="e.g., 123 Main St Investment Property"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Loan Type
              </label>
              <select
                value={form.loan_type}
                onChange={e => setForm({ ...form, loan_type: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {LOAN_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Loan Purpose
              </label>
              <select
                value={form.loan_purpose}
                onChange={e => setForm({ ...form, loan_purpose: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {LOAN_PURPOSES.map(purpose => (
                  <option key={purpose.value} value={purpose.value}>{purpose.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Property Information</h2>
              <p className="text-sm text-gray-500">Subject property details</p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Street Address
              </label>
              <input
                type="text"
                value={form.property_address}
                onChange={e => setForm({ ...form, property_address: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="123 Main Street"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City
              </label>
              <input
                type="text"
                value={form.property_city}
                onChange={e => setForm({ ...form, property_city: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  value={form.property_state}
                  onChange={e => setForm({ ...form, property_state: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Select</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ZIP
                </label>
                <input
                  type="text"
                  value={form.property_zip}
                  onChange={e => setForm({ ...form, property_zip: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Property Type
              </label>
              <select
                value={form.property_type}
                onChange={e => setForm({ ...form, property_type: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {PROPERTY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Occupancy Type
              </label>
              <select
                value={form.occupancy}
                onChange={e => setForm({ ...form, occupancy: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {OCCUPANCY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Financial Details</h2>
              <p className="text-sm text-gray-500">Loan amounts and income</p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Purchase Price ($)
              </label>
              <input
                type="number"
                min="0"
                value={form.purchase_price}
                onChange={e => setForm({ ...form, purchase_price: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="500000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Value ($)
              </label>
              <input
                type="number"
                min="0"
                value={form.estimated_value}
                onChange={e => setForm({ ...form, estimated_value: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Leave blank to use purchase price"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Loan Amount ($)
              </label>
              <input
                type="number"
                min="0"
                value={form.loan_amount}
                onChange={e => setForm({ ...form, loan_amount: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="400000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monthly Rent ($)
              </label>
              <input
                type="number"
                min="0"
                value={form.rent}
                onChange={e => setForm({ ...form, rent: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="For rental properties"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/borrower/scenarios')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !form.scenario_name}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Create Scenario
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
