import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower, PrequalResult, BorrowerStatus } from '../../shared/types';
import {
  CheckCircle,
  Clock,
  FileText,
  Search,
  ShieldCheck,
  ArrowRight,
  Info
} from 'lucide-react';
import { BorrowerStatusBadge } from '../../components/borrower/BorrowerStatusBadge';

interface StatusStep {
  status: BorrowerStatus;
  label: string;
  description: string;
  icon: typeof CheckCircle;
}

const STATUS_STEPS: StatusStep[] = [
  {
    status: 'draft',
    label: 'Profile Setup',
    description: 'Complete your profile and upload documents',
    icon: FileText
  },
  {
    status: 'submitted',
    label: 'Submitted',
    description: 'Application submitted for processing',
    icon: Clock
  },
  {
    status: 'documents_processing',
    label: 'Documents Processing',
    description: 'Your documents are being analyzed',
    icon: Clock
  },
  {
    status: 'prequalified',
    label: 'Pre-Approved',
    description: 'Financial pre-approval complete',
    icon: CheckCircle
  },
  {
    status: 'under_review',
    label: 'Under Review',
    description: 'Application under internal review',
    icon: Search
  },
  {
    status: 'approved',
    label: 'Approved',
    description: 'You can now create loan scenarios',
    icon: ShieldCheck
  }
];

export function BorrowerStatusPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [prequal, setPrequal] = useState<PrequalResult | null>(null);

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
        const { data: prequalData } = await supabase
          .from('prequal_results')
          .select('*')
          .eq('borrower_id', borrowerData.id)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        setPrequal(prequalData);
      }
    } finally {
      setLoading(false);
    }
  }

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
          <Info className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Application Found</h2>
          <p className="text-gray-600 mb-4">
            You haven't started an application yet. Create your profile to get started.
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

  const currentStatus = borrower.borrower_status || 'draft';
  const currentStepIndex = STATUS_STEPS.findIndex(s => s.status === currentStatus);

  const isDeclined = currentStatus === 'declined';
  const isConditional = currentStatus === 'conditionally_approved';
  const needsDocs = currentStatus === 'additional_docs_requested';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Application Status</h1>
        <p className="text-gray-600 mt-1">
          Track the progress of your loan application
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-gray-500">Current Status</p>
            <div className="mt-1">
              <BorrowerStatusBadge status={currentStatus} size="lg" />
            </div>
          </div>
          {prequal && (
            <div className="text-right">
              <p className="text-sm text-gray-500">Pre-Approved Amount</p>
              <p className="text-2xl font-bold text-teal-600 mt-1">
                {formatCurrency(prequal.prequalified_amount)}
              </p>
            </div>
          )}
        </div>

        {!isDeclined && !needsDocs && (
          <div className="relative">
            <div className="absolute left-4 top-8 bottom-8 w-0.5 bg-gray-200" />

            <div className="space-y-6">
              {STATUS_STEPS.map((step, index) => {
                const isComplete = index < currentStepIndex;
                const isCurrent = index === currentStepIndex;
                const isFuture = index > currentStepIndex;
                const Icon = step.icon;

                return (
                  <div key={step.status} className="relative flex items-start gap-4">
                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                      isComplete ? 'bg-teal-600' :
                      isCurrent ? 'bg-teal-600 ring-4 ring-teal-100' :
                      'bg-gray-200'
                    }`}>
                      {isComplete ? (
                        <CheckCircle className="w-5 h-5 text-white" />
                      ) : (
                        <Icon className={`w-4 h-4 ${isCurrent ? 'text-white' : 'text-gray-400'}`} />
                      )}
                    </div>
                    <div className={`flex-1 pt-1 ${isFuture ? 'opacity-50' : ''}`}>
                      <p className={`font-medium ${isCurrent ? 'text-teal-700' : 'text-gray-900'}`}>
                        {step.label}
                      </p>
                      <p className="text-sm text-gray-500">{step.description}</p>
                    </div>
                    {isCurrent && (
                      <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-1 rounded">
                        Current
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {needsDocs && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">Additional Documents Required</p>
                <p className="text-sm text-amber-700 mt-1">
                  Please upload the requested documents to continue your application process.
                </p>
                <Link
                  to="/borrower/documents"
                  className="inline-flex items-center gap-2 text-amber-800 font-medium text-sm mt-2 hover:underline"
                >
                  Upload Documents <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {isDeclined && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="font-medium text-red-800">Application Not Approved</p>
            <p className="text-sm text-red-700 mt-1">
              Unfortunately, we were unable to approve your application at this time.
              Please contact our support team for more information.
            </p>
          </div>
        )}

        {isConditional && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-800">Conditionally Approved</p>
                <p className="text-sm text-emerald-700 mt-1">
                  Your borrower profile has been conditionally approved. You can now create
                  property-specific loan scenarios.
                </p>
                <Link
                  to="/borrower/scenarios/new"
                  className="inline-flex items-center gap-2 text-emerald-800 font-medium text-sm mt-2 hover:underline"
                >
                  Create Loan Scenario <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {currentStatus === 'approved' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Fully Approved</p>
                <p className="text-sm text-green-700 mt-1">
                  Congratulations! Your borrower profile has been approved. You can now create
                  property-specific loan scenarios.
                </p>
                <Link
                  to="/borrower/scenarios/new"
                  className="inline-flex items-center gap-2 text-green-800 font-medium text-sm mt-2 hover:underline"
                >
                  Create Loan Scenario <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
