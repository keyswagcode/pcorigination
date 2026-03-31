import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type {
  Borrower,
  BorrowerFinancialProfile,
  PrequalResult,
  BorrowerIdentityDocument,
  AnalystDecisionRecord,
  LoanScenario
} from '../../shared/types';
import {
  ArrowLeft,
  User,
  FileText,
  DollarSign,
  Bot,
  CheckCircle,
  Building2,
  AlertCircle,
  XCircle,
  Clock,
  UserCheck
} from 'lucide-react';
import { BorrowerFileHeader } from '../../components/internal/BorrowerFileHeader';
import { DocumentsReviewPanel } from '../../components/internal/DocumentsReviewPanel';
import { IdentityDocumentsPanel } from '../../components/internal/IdentityDocumentsPanel';
import { ExtractedFinancialsPanel } from '../../components/internal/ExtractedFinancialsPanel';
import { PlacerBotResultsPanel } from '../../components/internal/PlacerBotResultsPanel';
import { AnalystDecisionPanel } from '../../components/internal/AnalystDecisionPanel';
import { getLoanTypeConfig, type BorrowerLoanType, LOAN_TYPE_DOCUMENT_CONFIG } from '../../lib/loanTypeDocuments';

type TabId = 'overview' | 'documents' | 'financials' | 'underwriting' | 'decision' | 'scenarios';

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'financials', label: 'Financials', icon: DollarSign },
  { id: 'underwriting', label: 'Underwriting', icon: Bot },
  { id: 'decision', label: 'Decision', icon: CheckCircle },
  { id: 'scenarios', label: 'Scenarios', icon: Building2 },
];

interface UploadedDoc {
  id: string;
  document_type: string;
  file_name: string;
  processing_status: string;
  created_at: string;
}

export function BorrowerFilePage() {
  const { borrowerId } = useParams<{ borrowerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  useAuth();
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [financialProfile, setFinancialProfile] = useState<BorrowerFinancialProfile | null>(null);
  const [prequal, setPrequal] = useState<PrequalResult | null>(null);
  const [identityDocs, setIdentityDocs] = useState<BorrowerIdentityDocument[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [decisions, setDecisions] = useState<AnalystDecisionRecord[]>([]);
  const [scenarios, setScenarios] = useState<LoanScenario[]>([]);

  const activeTab = (searchParams.get('tab') as TabId) || 'overview';

  useEffect(() => {
    if (borrowerId) {
      loadBorrowerData();
    }
  }, [borrowerId]);

  async function loadBorrowerData() {
    setLoading(true);
    try {
      const [
        borrowerRes,
        financialRes,
        prequalRes,
        idDocsRes,
        docsRes,
        decisionsRes,
        scenariosRes
      ] = await Promise.all([
        supabase.from('borrowers').select('*').eq('id', borrowerId).maybeSingle(),
        supabase.from('borrower_financial_profiles').select('*').eq('borrower_id', borrowerId).maybeSingle(),
        supabase.from('prequal_results').select('*').eq('borrower_id', borrowerId).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('borrower_identity_documents').select('*').eq('borrower_id', borrowerId).order('uploaded_at', { ascending: false }),
        supabase.from('uploaded_documents').select('id, document_type, file_name, processing_status, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
        supabase.from('analyst_decisions').select('*').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
        supabase.from('loan_scenarios').select('*').eq('borrower_id', borrowerId).order('created_at', { ascending: false })
      ]);

      setBorrower(borrowerRes.data);
      setFinancialProfile(financialRes.data);
      setPrequal(prequalRes.data);
      setIdentityDocs(idDocsRes.data || []);
      setDocuments(docsRes.data || []);
      setDecisions(decisionsRes.data || []);
      setScenarios(scenariosRes.data || []);
    } finally {
      setLoading(false);
    }
  }

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  const handleDecisionSaved = () => {
    loadBorrowerData();
  };

  const handleIdVerificationUpdate = () => {
    loadBorrowerData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Borrower Not Found</h2>
          <p className="text-gray-600 mb-4">The requested borrower could not be found.</p>
          <Link
            to="/internal/borrowers"
            className="inline-flex items-center gap-2 text-teal-600 font-medium hover:text-teal-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Queue
          </Link>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const loanTypeConfig = getLoanTypeConfig(borrower.preferred_loan_type as BorrowerLoanType);
  const hasLoanType = borrower.preferred_loan_type && borrower.preferred_loan_type !== 'not_sure';
  const uploadedDocTypes = documents.map(d => d.document_type);
  const requiredDocs = loanTypeConfig.documents.filter(d => d.required);
  const optionalDocs = loanTypeConfig.documents.filter(d => !d.required);

  const eligibleApplicationTypes = prequal?.passes_liquidity_check
    ? (hasLoanType ? [loanTypeConfig] : Object.values(LOAN_TYPE_DOCUMENT_CONFIG).filter(c => c.loanType !== 'not_sure'))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/internal/borrowers"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Queue
        </Link>

        <BorrowerFileHeader borrower={borrower} prequal={prequal} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-teal-600 text-teal-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900">Loan Type & Document Status</h3>
                      {hasLoanType && (
                        <span className="px-3 py-1 bg-teal-100 text-teal-800 text-sm font-medium rounded-full">
                          {loanTypeConfig.label}
                        </span>
                      )}
                    </div>

                    {!hasLoanType && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                        <div className="flex items-center gap-2 text-amber-800">
                          <AlertCircle className="w-4 h-4" />
                          <span className="font-medium">No loan type selected</span>
                        </div>
                        <p className="text-sm text-amber-700 mt-1">
                          Borrower has not selected a preferred loan type yet.
                        </p>
                      </div>
                    )}

                    {hasLoanType && (
                      <>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-left py-2 font-medium text-gray-500">Required Document</th>
                              <th className="text-center py-2 font-medium text-gray-500">Status</th>
                              <th className="text-left py-2 font-medium text-gray-500">Uploaded File</th>
                            </tr>
                          </thead>
                          <tbody>
                            {requiredDocs.map((doc, idx) => {
                              const uploaded = documents.find(d => d.document_type === doc.type);
                              return (
                                <tr key={idx} className="border-b border-slate-100">
                                  <td className="py-3">
                                    <span className="font-medium text-gray-900">{doc.label}</span>
                                    {doc.preferred && (
                                      <p className="text-xs text-gray-500">{doc.preferred}</p>
                                    )}
                                  </td>
                                  <td className="py-3 text-center">
                                    {uploaded ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                                        <CheckCircle className="w-3 h-3" />
                                        Uploaded
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">
                                        <XCircle className="w-3 h-3" />
                                        Missing
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 text-gray-600">
                                    {uploaded ? uploaded.file_name : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        {optionalDocs.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-slate-200">
                            <p className="text-xs text-gray-500 mb-2">Optional Documents</p>
                            <div className="flex flex-wrap gap-2">
                              {optionalDocs.map((doc, idx) => {
                                const uploaded = uploadedDocTypes.includes(doc.type);
                                return (
                                  <span
                                    key={idx}
                                    className={`px-2 py-1 rounded text-xs font-medium ${
                                      uploaded ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {doc.label} {uploaded && <CheckCircle className="w-3 h-3 inline ml-1" />}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                    <h3 className="font-semibold text-gray-900 mb-4">Pre-Approval Status</h3>

                    {prequal ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Liquidity Requirement</span>
                          <span className="font-medium">
                            {loanTypeConfig.liquidityRule.multiplier}x {loanTypeConfig.liquidityRule.basis.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Liquidity Check</span>
                          {prequal.passes_liquidity_check ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                              <CheckCircle className="w-4 h-4" />
                              Passed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-sm font-medium">
                              <XCircle className="w-4 h-4" />
                              Failed
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Pre-Approved Amount</span>
                          <span className="font-bold text-lg">{formatCurrency(prequal.prequalified_amount)}</span>
                        </div>
                        {prequal.verified_liquidity !== undefined && prequal.verified_liquidity !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Verified Liquidity</span>
                            <span className="font-medium">{formatCurrency(prequal.verified_liquidity)}</span>
                          </div>
                        )}
                        {prequal.required_liquidity !== undefined && prequal.required_liquidity !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Required Liquidity</span>
                            <span className="font-medium">{formatCurrency(prequal.required_liquidity)}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-amber-600">
                        <Clock className="w-4 h-4" />
                        <span>Pre-approval not yet generated</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                    <h3 className="font-semibold text-gray-900 mb-4">Eligible Applications</h3>

                    {eligibleApplicationTypes.length > 0 ? (
                      <div className="space-y-2">
                        {eligibleApplicationTypes.map((config) => (
                          <div
                            key={config.loanType}
                            className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200"
                          >
                            <div>
                              <span className="font-medium text-gray-900">{config.label}</span>
                              <p className="text-xs text-gray-500">{config.description}</p>
                            </div>
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                              Available
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500">
                        <AlertCircle className="w-4 h-4" />
                        <span>No applications available until pre-approval passes</span>
                      </div>
                    )}

                    {scenarios.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <p className="text-sm font-medium text-gray-700 mb-2">Active Applications ({scenarios.length})</p>
                        <div className="space-y-2">
                          {scenarios.slice(0, 3).map(scenario => (
                            <Link
                              key={scenario.id}
                              to={`/internal/scenarios/${scenario.id}`}
                              className="flex items-center justify-between p-2 bg-white rounded border border-slate-200 hover:border-teal-300 transition-colors"
                            >
                              <span className="text-sm text-gray-900">{scenario.scenario_name}</span>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                scenario.status === 'approved' ? 'bg-green-100 text-green-700' :
                                scenario.status === 'declined' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {scenario.status}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900 mb-3">Borrower Info</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Name</span>
                        <span className="font-medium text-gray-900">{borrower.borrower_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Email</span>
                        <span className="text-gray-900">{borrower.email || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Phone</span>
                        <span className="text-gray-900">{borrower.phone || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Entity</span>
                        <span className="text-gray-900 capitalize">{borrower.entity_type || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">State</span>
                        <span className="text-gray-900">{borrower.state_of_residence || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Credit Score</span>
                        <span className={`font-medium ${
                          (borrower.credit_score || 0) >= 740 ? 'text-green-600' :
                          (borrower.credit_score || 0) >= 680 ? 'text-amber-600' :
                          'text-red-600'
                        }`}>
                          {borrower.credit_score || '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900 mb-3">Experience</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">RE Experience</span>
                        <span className="text-gray-900">{borrower.real_estate_experience_years || 0} yrs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Properties</span>
                        <span className="text-gray-900">{borrower.properties_owned_count || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Portfolio</span>
                        <span className="text-gray-900">{formatCurrency(borrower.portfolio_value || null)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900 mb-3">AE Ownership</h4>
                    {borrower.assigned_ae_id ? (
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-gray-900">Assigned</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-gray-500">Not assigned</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900 mb-3">ID Verification</h4>
                    {borrower.id_document_verified ? (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm">Verified</span>
                      </div>
                    ) : identityDocs.length > 0 ? (
                      <div className="flex items-center gap-2 text-amber-600">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">Pending review</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-400">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">Not uploaded</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-6">
              <DocumentsReviewPanel documents={documents} />
              <IdentityDocumentsPanel
                identityDocs={identityDocs}
                borrowerId={borrower.id}
                onUpdate={handleIdVerificationUpdate}
              />
            </div>
          )}

          {activeTab === 'financials' && (
            <ExtractedFinancialsPanel
              financialProfile={financialProfile}
              borrowerId={borrower.id}
            />
          )}

          {activeTab === 'underwriting' && (
            <PlacerBotResultsPanel borrowerId={borrower.id} />
          )}

          {activeTab === 'decision' && (
            <AnalystDecisionPanel
              borrower={borrower}
              decisions={decisions}
              onDecisionSaved={handleDecisionSaved}
            />
          )}

          {activeTab === 'scenarios' && (
            <div>
              {scenarios.length === 0 ? (
                <div className="text-center py-12">
                  <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600">No loan scenarios created yet</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Scenarios can be created after borrower approval
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {scenarios.map(scenario => (
                    <Link
                      key={scenario.id}
                      to={`/internal/scenarios/${scenario.id}`}
                      className="block p-4 border border-gray-200 rounded-lg hover:border-teal-300 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{scenario.scenario_name}</p>
                          <p className="text-sm text-gray-500">
                            {scenario.property_address || 'No address'} - {formatCurrency(scenario.loan_amount)}
                          </p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          scenario.status === 'approved' ? 'bg-green-100 text-green-700' :
                          scenario.status === 'declined' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {scenario.status.replace('_', ' ')}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
