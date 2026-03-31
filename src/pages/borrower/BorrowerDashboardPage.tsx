import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Borrower, PrequalResult, BorrowerIdentityDocument, LoanScenario } from '../../shared/types';
import {
  User,
  FileText,
  Shield,
  CheckCircle,
  Clock,
  AlertCircle,
  ArrowRight,
  Building2,
  DollarSign,
  Upload,
  Download,
  PlayCircle
} from 'lucide-react';
import { BorrowerStatusBadge } from '../../components/borrower/BorrowerStatusBadge';
import { getLoanTypeConfig, type BorrowerLoanType, LOAN_TYPE_DOCUMENT_CONFIG } from '../../lib/loanTypeDocuments';

interface UploadedDoc {
  id: string;
  document_type: string;
  file_name: string;
  processing_status: string;
}

export function BorrowerDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [prequal, setPrequal] = useState<PrequalResult | null>(null);
  const [identityDoc, setIdentityDoc] = useState<BorrowerIdentityDocument | null>(null);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [scenarios, setScenarios] = useState<LoanScenario[]>([]);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  async function loadDashboardData() {
    setLoading(true);
    try {
      const { data: borrowerData } = await supabase
        .from('borrowers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      setBorrower(borrowerData);

      if (borrowerData) {
        const [prequalRes, idDocRes, docsRes, scenariosRes] = await Promise.all([
          supabase
            .from('prequal_results')
            .select('*')
            .eq('borrower_id', borrowerData.id)
            .order('generated_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('borrower_identity_documents')
            .select('*')
            .eq('borrower_id', borrowerData.id)
            .order('uploaded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('uploaded_documents')
            .select('id, document_type, file_name, processing_status')
            .eq('borrower_id', borrowerData.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('loan_scenarios')
            .select('*')
            .eq('borrower_id', borrowerData.id)
            .order('created_at', { ascending: false })
            .limit(5)
        ]);

        setPrequal(prequalRes.data);
        setIdentityDoc(idDocRes.data);
        setDocuments(docsRes.data || []);
        setScenarios(scenariosRes.data || []);
      }
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
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-teal-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to Loan Center</h2>
          <p className="text-gray-600 mb-6">
            Let's get started by setting up your profile. This will help us understand your financial situation
            and match you with the best loan options.
          </p>
          <Link
            to="/borrower/profile"
            className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
          >
            Create Your Profile
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  const profileComplete = borrower.borrower_name && borrower.email && borrower.credit_score;
  const hasLoanType = borrower.preferred_loan_type && borrower.preferred_loan_type !== 'not_sure';
  const loanTypeConfig = getLoanTypeConfig(borrower.preferred_loan_type as BorrowerLoanType);

  const requiredDocTypes = loanTypeConfig.documents.filter(d => d.required).map(d => d.type);
  const uploadedDocTypes = documents.map(d => d.document_type);
  const missingDocs = requiredDocTypes.filter(t => !uploadedDocTypes.includes(t));
  const hasAllRequiredDocs = missingDocs.length === 0 && documents.length > 0;

  const canApplyForLoans = prequal && prequal.passes_liquidity_check;
  const availableLoanTypes = hasLoanType ? [loanTypeConfig] : Object.values(LOAN_TYPE_DOCUMENT_CONFIG).filter(c => c.loanType !== 'not_sure');

  const progressSteps = [
    { id: 'profile', label: 'Profile', complete: !!profileComplete },
    { id: 'loan_type', label: 'Loan Type', complete: !!hasLoanType },
    { id: 'documents', label: 'Documents', complete: hasAllRequiredDocs },
    { id: 'preapproval', label: 'Pre-Approval', complete: !!prequal },
    { id: 'apply', label: 'Apply', complete: scenarios.length > 0 },
  ];

  const currentStep = progressSteps.findIndex(s => !s.complete);
  const progressPercent = currentStep === -1 ? 100 : Math.round((currentStep / progressSteps.length) * 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Welcome back, {borrower.borrower_name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-gray-600 mt-1">
            Here's your loan application progress
          </p>
        </div>
        {borrower.borrower_status && (
          <BorrowerStatusBadge status={borrower.borrower_status} size="lg" />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Your Progress</h3>
          <span className="text-sm text-teal-600 font-medium">{progressPercent}% complete</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-teal-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between">
          {progressSteps.map((step, idx) => (
            <div key={step.id} className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
                step.complete ? 'bg-teal-500 text-white' :
                idx === currentStep ? 'bg-teal-100 text-teal-600 ring-2 ring-teal-500' :
                'bg-gray-200 text-gray-400'
              }`}>
                {step.complete ? <CheckCircle className="w-4 h-4" /> : <span className="text-xs font-bold">{idx + 1}</span>}
              </div>
              <span className={`text-xs font-medium ${step.complete || idx === currentStep ? 'text-gray-900' : 'text-gray-400'}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/borrower/profile"
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            {profileComplete ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <h3 className="font-medium text-gray-900 mt-3">Profile</h3>
          <p className="text-sm text-gray-500 mt-1">
            {profileComplete ? 'Complete' : 'Needs attention'}
          </p>
          <span className="text-sm text-teal-600 font-medium flex items-center gap-1 mt-3 group-hover:gap-2 transition-all">
            View profile <ArrowRight className="w-4 h-4" />
          </span>
        </Link>

        <Link
          to="/borrower/documents"
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-teal-600" />
            </div>
            <span className="text-sm font-medium text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
              {documents.length}
            </span>
          </div>
          <h3 className="font-medium text-gray-900 mt-3">Documents</h3>
          <p className="text-sm text-gray-500 mt-1">
            {documents.length === 0 ? 'No documents yet' : `${documents.length} uploaded`}
          </p>
          <span className="text-sm text-teal-600 font-medium flex items-center gap-1 mt-3 group-hover:gap-2 transition-all">
            Manage documents <ArrowRight className="w-4 h-4" />
          </span>
        </Link>

        <Link
          to="/borrower/documents"
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
        >
          <div className="flex items-start justify-between">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-amber-600" />
            </div>
            {identityDoc?.verification_status === 'verified' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : identityDoc ? (
              <Clock className="w-5 h-5 text-amber-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-gray-400" />
            )}
          </div>
          <h3 className="font-medium text-gray-900 mt-3">Identity Verification</h3>
          <p className="text-sm text-gray-500 mt-1">
            {!identityDoc ? 'Not uploaded' :
              identityDoc.verification_status === 'verified' ? 'Verified' :
              identityDoc.verification_status === 'rejected' ? 'Needs resubmission' :
              'Pending review'}
          </p>
          <span className="text-sm text-teal-600 font-medium flex items-center gap-1 mt-3 group-hover:gap-2 transition-all">
            {identityDoc ? 'View status' : 'Upload ID'} <ArrowRight className="w-4 h-4" />
          </span>
        </Link>
      </div>

      {!hasLoanType && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">Step 2: Select Your Loan Type</h3>
              <p className="text-amber-800 text-sm mt-1">
                Choose a loan type to see exactly what documents you need and understand the liquidity requirements for pre-approval.
              </p>
              <Link
                to="/borrower/profile"
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-medium mt-3 hover:bg-amber-700 transition-colors"
              >
                Select Loan Type <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {hasLoanType && !prequal && (
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-600 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    Documents for {loanTypeConfig.label} Pre-Approval
                  </h3>
                  <p className="text-sm text-gray-600">{loanTypeConfig.description}</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-teal-100 text-teal-800 text-sm font-medium rounded-full">
                {loanTypeConfig.label}
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-gray-500" />
                  Required Documents
                </h4>
                <ul className="space-y-2">
                  {loanTypeConfig.documents.filter(d => d.required).map((doc, idx) => {
                    const isUploaded = uploadedDocTypes.includes(doc.type);
                    return (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isUploaded ? 'bg-green-500' : 'bg-teal-600'
                        }`}>
                          {isUploaded ? (
                            <CheckCircle className="w-3 h-3 text-white" />
                          ) : (
                            <span className="text-white text-xs font-bold">{idx + 1}</span>
                          )}
                        </div>
                        <div>
                          <span className={`font-medium ${isUploaded ? 'text-green-700' : 'text-gray-900'}`}>
                            {doc.label}
                          </span>
                          {doc.preferred && (
                            <p className="text-gray-500 text-xs mt-0.5">{doc.preferred}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {loanTypeConfig.documents.filter(d => !d.required).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-gray-500 mb-2">Optional but helpful:</p>
                    <ul className="space-y-1">
                      {loanTypeConfig.documents.filter(d => !d.required).map((doc, idx) => (
                        <li key={idx} className="text-sm text-gray-600 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                          {doc.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-teal-600" />
                  Liquidity Verification
                </h4>
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-3xl font-bold text-teal-600">
                    {loanTypeConfig.liquidityRule.multiplier}x
                  </div>
                  <div className="text-sm text-gray-600">
                    {loanTypeConfig.liquidityRule.description}
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {loanTypeConfig.preApprovalNote}
                </p>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200">
              <Link
                to="/borrower/documents"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Documents
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {prequal && (
        <div className={`rounded-xl border overflow-hidden ${
          prequal.passes_liquidity_check
            ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-200'
            : 'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200'
        }`}>
          <div className="p-5 border-b border-green-200/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  prequal.passes_liquidity_check ? 'bg-green-500' : 'bg-amber-500'
                }`}>
                  {prequal.passes_liquidity_check ? (
                    <CheckCircle className="w-6 h-6 text-white" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-white" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {prequal.passes_liquidity_check ? 'Pre-Approved!' : 'Pre-Approval Pending'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {prequal.passes_liquidity_check
                      ? 'You meet the liquidity requirements'
                      : 'Additional documentation may be needed'}
                  </p>
                </div>
              </div>
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                prequal.passes_liquidity_check
                  ? 'bg-green-200 text-green-800'
                  : 'bg-amber-200 text-amber-800'
              }`}>
                {prequal.passes_liquidity_check ? 'Qualified' : 'Review Required'}
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-white/80 rounded-lg p-4">
                <p className="text-sm text-gray-500 mb-1">Pre-Approved Amount</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(prequal.prequalified_amount)}
                </p>
              </div>
              {prequal.qualification_range_low && prequal.qualification_range_high && (
                <div className="bg-white/80 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Qualification Range</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrency(prequal.qualification_range_low)} - {formatCurrency(prequal.qualification_range_high)}
                  </p>
                </div>
              )}
              {prequal.verified_liquidity !== undefined && prequal.verified_liquidity !== null && (
                <div className="bg-white/80 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Verified Liquidity</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrency(prequal.verified_liquidity)}
                  </p>
                </div>
              )}
            </div>

            {prequal.letter_url && (
              <a
                href={prequal.letter_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Pre-Approval Letter
              </a>
            )}
          </div>
        </div>
      )}

      {canApplyForLoans && (
        <div className="bg-gradient-to-br from-teal-600 to-teal-700 rounded-xl p-6 text-white">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <PlayCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">You Can Now Apply for These Loans</h3>
              <p className="text-teal-100 mt-1">
                Your pre-approval is complete. Start your loan application for any of the available loan types below.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            {availableLoanTypes.map((config) => (
              <Link
                key={config.loanType}
                to={`/borrower/scenarios/new?loanType=${config.loanType}`}
                className="bg-white rounded-lg p-4 hover:shadow-lg transition-all group"
              >
                <h4 className="font-semibold text-gray-900">{config.label}</h4>
                <p className="text-sm text-gray-500 mt-1">{config.description}</p>
                <span className="text-sm text-teal-600 font-medium flex items-center gap-1 mt-3 group-hover:gap-2 transition-all">
                  Start Application <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!canApplyForLoans && prequal && !prequal.passes_liquidity_check && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">Additional Documentation Needed</h3>
              <p className="text-gray-600 mt-1">
                Your liquidity verification did not meet the {loanTypeConfig.liquidityRule.multiplier}x requirement.
                Please upload additional bank statements or proof of funds to continue.
              </p>
              <Link
                to="/borrower/documents"
                className="inline-flex items-center gap-2 text-teal-600 font-medium mt-3 hover:text-teal-700"
              >
                Upload More Documents <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {scenarios.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-5 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Your Loan Applications</h3>
                <p className="text-sm text-gray-500">{scenarios.length} application(s)</p>
              </div>
            </div>
            {canApplyForLoans && (
              <Link
                to="/borrower/scenarios/new"
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
              >
                New Application
              </Link>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {scenarios.map(scenario => (
              <Link
                key={scenario.id}
                to={`/borrower/scenarios/${scenario.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{scenario.scenario_name}</p>
                  <p className="text-sm text-gray-500">
                    {scenario.property_address || 'No address'}
                    {scenario.loan_amount && ` - ${formatCurrency(scenario.loan_amount)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    scenario.status === 'approved' ? 'bg-green-100 text-green-700' :
                    scenario.status === 'declined' ? 'bg-red-100 text-red-700' :
                    scenario.status === 'matched' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {scenario.status.replace('_', ' ')}
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
