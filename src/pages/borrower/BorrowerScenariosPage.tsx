import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower, LoanScenario } from '../../shared/types';
import {
  Building2,
  Plus,
  ArrowRight,
  DollarSign,
  MapPin,
  Calendar
} from 'lucide-react';
import { ScenarioAccessGate } from '../../components/borrower/ScenarioAccessGate';

export function BorrowerScenariosPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [scenarios, setScenarios] = useState<LoanScenario[]>([]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: borrowerData } = await supabase
        .from('borrowers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      setBorrower(borrowerData);

      if (borrowerData) {
        const { data: scenariosData } = await supabase
          .from('loan_scenarios')
          .select('*')
          .eq('borrower_id', borrowerData.id)
          .order('created_at', { ascending: false });

        setScenarios(scenariosData || []);
      }
    } finally {
      setLoading(false);
    }
  }

  const canCreateScenarios = borrower?.borrower_status === 'approved' ||
    borrower?.borrower_status === 'conditionally_approved';

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-700';
      case 'conditionally_approved': return 'bg-emerald-100 text-emerald-700';
      case 'matched': return 'bg-blue-100 text-blue-700';
      case 'under_review': return 'bg-amber-100 text-amber-700';
      case 'declined': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Profile Required</h2>
          <p className="text-gray-600 mb-4">
            Please complete your profile before creating loan scenarios.
          </p>
          <Link
            to="/borrower/profile"
            className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700"
          >
            Create Profile <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (!canCreateScenarios) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Loan Scenarios</h1>
          <p className="text-gray-600 mt-1">
            Create property-specific loan scenarios after approval
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <ScenarioAccessGate status={borrower.borrower_status || 'draft'} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Loan Scenarios</h1>
          <p className="text-gray-600 mt-1">
            Create and manage property-specific loan scenarios
          </p>
        </div>
        <Link
          to="/borrower/scenarios/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Scenario
        </Link>
      </div>

      {scenarios.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Scenarios Yet</h2>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Create your first loan scenario to explore financing options for a specific property.
          </p>
          <Link
            to="/borrower/scenarios/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700"
          >
            <Plus className="w-4 h-4" />
            Create First Scenario
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map(scenario => (
            <Link
              key={scenario.id}
              to={`/borrower/scenarios/${scenario.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-gray-900 group-hover:text-teal-700">
                  {scenario.scenario_name}
                </h3>
                <span className={`text-xs font-medium px-2 py-1 rounded ${getStatusColor(scenario.status)}`}>
                  {scenario.status.replace('_', ' ')}
                </span>
              </div>

              {scenario.property_address && (
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span>{scenario.property_address}, {scenario.property_city}, {scenario.property_state}</span>
                </div>
              )}

              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                {scenario.loan_amount && (
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(scenario.loan_amount)}
                    </span>
                  </div>
                )}
                {scenario.loan_type && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded uppercase">
                    {scenario.loan_type}
                  </span>
                )}
                <div className="flex items-center gap-1.5 ml-auto text-gray-400">
                  <Calendar className="w-4 h-4" />
                  <span className="text-xs">
                    {new Date(scenario.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
