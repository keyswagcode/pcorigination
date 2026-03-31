import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { LoanScenario } from '../../shared/types';
import {
  Building2,
  ArrowLeft,
  MapPin,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

export function BorrowerScenarioDetailPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [scenario, setScenario] = useState<LoanScenario | null>(null);

  useEffect(() => {
    if (user && scenarioId) {
      loadScenario();
    }
  }, [user, scenarioId]);

  async function loadScenario() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('loan_scenarios')
        .select('*')
        .eq('id', scenarioId)
        .maybeSingle();

      setScenario(data);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'approved':
        return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', label: 'Approved' };
      case 'conditionally_approved':
        return { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Conditionally Approved' };
      case 'matched':
        return { icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Matched' };
      case 'under_review':
        return { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100', label: 'Under Review' };
      case 'declined':
        return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100', label: 'Declined' };
      default:
        return { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-100', label: status.replace('_', ' ') };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Scenario Not Found</h2>
          <p className="text-gray-600 mb-4">
            The requested loan scenario could not be found.
          </p>
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

  const statusDisplay = getStatusDisplay(scenario.status);
  const StatusIcon = statusDisplay.icon;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link
          to="/borrower/scenarios"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Scenarios
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{scenario.scenario_name}</h1>
            {scenario.property_address && (
              <p className="text-gray-600 mt-1 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {scenario.property_address}, {scenario.property_city}, {scenario.property_state} {scenario.property_zip}
              </p>
            )}
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${statusDisplay.bg}`}>
            <StatusIcon className={`w-4 h-4 ${statusDisplay.color}`} />
            <span className={`text-sm font-medium ${statusDisplay.color}`}>
              {statusDisplay.label}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-teal-600" />
            </div>
            <p className="text-sm text-gray-500">Loan Amount</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatCurrency(scenario.loan_amount)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-sm text-gray-500">LTV</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {scenario.ltv ? `${scenario.ltv.toFixed(1)}%` : '-'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-sm text-gray-500">DSCR</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {scenario.dscr ? scenario.dscr.toFixed(2) : '-'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Property Details</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-500">Property Type</span>
              <span className="font-medium text-gray-900 capitalize">
                {scenario.property_type?.replace('_', ' ') || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Occupancy</span>
              <span className="font-medium text-gray-900 capitalize">
                {scenario.occupancy || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Purchase Price</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(scenario.purchase_price)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Estimated Value</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(scenario.estimated_value)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Monthly Rent</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(scenario.rent)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Loan Details</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-500">Loan Type</span>
              <span className="font-medium text-gray-900 uppercase">
                {scenario.loan_type || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Loan Purpose</span>
              <span className="font-medium text-gray-900 capitalize">
                {scenario.loan_purpose?.replace('_', ' ') || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Loan Amount</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(scenario.loan_amount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span className="font-medium text-gray-900">
                {new Date(scenario.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {scenario.status === 'draft' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">Scenario in Draft</p>
              <p className="text-sm text-amber-700 mt-1">
                This scenario is saved as a draft. Submit it for review when you're ready to proceed.
              </p>
            </div>
          </div>
        </div>
      )}

      {scenario.status === 'under_review' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-800">Under Review</p>
              <p className="text-sm text-blue-700 mt-1">
                Your scenario is being reviewed by our underwriting team. We'll notify you when there are updates.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
