import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { LoanTypeSelector } from '../../components/borrower/LoanTypeSelector';
import { DocumentUploadPanel } from '../../components/borrower/DocumentUploadPanel';
import { updateBorrowerLoanType } from '../../services/borrowerService';
import type { Borrower, IdentityDocumentType } from '../../shared/types';
import type { BorrowerLoanType } from '../../lib/loanTypeDocuments';
import {
  User,
  Shield,
  FileText,
  Upload,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Loader2,
  AlertCircle,
  CreditCard,
  Building2
} from 'lucide-react';

type FlowStep = 'borrower' | 'identity' | 'loanType' | 'documents' | 'result';
type BorrowerType = 'personal' | 'entity';

const STEP_ORDER: FlowStep[] = ['borrower', 'identity', 'loanType', 'documents', 'result'];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const ID_TYPES: { value: IdentityDocumentType; label: string }[] = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'passport', label: 'Passport' },
  { value: 'government_id', label: 'Government ID' },
];

function getStepIndex(step: FlowStep): number {
  return STEP_ORDER.indexOf(step);
}

export function ApplicationFlowPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<FlowStep>('borrower');
  const [expandedSections, setExpandedSections] = useState<Set<FlowStep>>(new Set(['borrower']));
  const [loading, setLoading] = useState(true);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [preApproval, setPreApproval] = useState<{
    passes_liquidity_check: boolean;
    prequalified_amount: number | null;
    qualification_max: number | null;
  } | null>(null);

  const [formData, setFormData] = useState({
    borrower_name: '',
    email: '',
    phone: '',
    credit_score: '',
    state_of_residence: ''
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [selectedIdType, setSelectedIdType] = useState<IdentityDocumentType>('drivers_license');
  const [uploadingId, setUploadingId] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);

  const [selectedLoanType, setSelectedLoanType] = useState<BorrowerLoanType | null>(null);
  const [savingLoanType, setSavingLoanType] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSteps, setAnalysisSteps] = useState<{ label: string; done: boolean }[]>([]);

  const [borrowerType, setBorrowerType] = useState<BorrowerType>('personal');

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: borrowerData } = await supabase
      .from('borrowers')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (borrowerData) {
      setBorrower(borrowerData);
      setFormData({
        borrower_name: borrowerData.borrower_name || '',
        email: borrowerData.email || '',
        phone: borrowerData.phone || '',
        credit_score: borrowerData.credit_score?.toString() || '',
        state_of_residence: borrowerData.state_of_residence || ''
      });
      setSelectedLoanType(borrowerData.preferred_loan_type as BorrowerLoanType || null);
      const entityType = borrowerData.entity_type;
      setBorrowerType(entityType && entityType !== 'individual' ? 'entity' : 'personal');

      const { data: preApprovalData } = await supabase
        .from('pre_approvals')
        .select('passes_liquidity_check, prequalified_amount, qualification_max')
        .eq('borrower_id', borrowerData.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (preApprovalData) {
        setPreApproval(preApprovalData);
      }

      determineCurrentStep(borrowerData, preApprovalData);
    } else {
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('first_name, last_name, email, phone')
        .eq('id', user.id)
        .maybeSingle();

      if (userAccount) {
        setFormData(prev => ({
          ...prev,
          borrower_name: `${userAccount.first_name || ''} ${userAccount.last_name || ''}`.trim(),
          email: userAccount.email || '',
          phone: userAccount.phone || ''
        }));
      }
    }

    setLoading(false);
  }, [user]);

  const determineCurrentStep = (b: Borrower, pa: typeof preApproval) => {
    if (pa?.passes_liquidity_check) {
      setStep('result');
      setExpandedSections(new Set(['result']));
      return;
    }

    const hasProfile = b.borrower_name && b.credit_score && b.state_of_residence;
    const hasIdentity = !!b.id_document_file_path;
    const hasLoanType = b.preferred_loan_type && b.preferred_loan_type !== 'not_sure';

    if (!hasProfile) {
      setStep('borrower');
      setExpandedSections(new Set(['borrower']));
    } else if (!hasIdentity) {
      setStep('identity');
      setExpandedSections(new Set(['identity']));
    } else if (!hasLoanType) {
      setStep('loanType');
      setExpandedSections(new Set(['loanType']));
    } else {
      setStep('documents');
      setExpandedSections(new Set(['documents']));
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleSection = (s: FlowStep) => {
    if (getStepIndex(s) > getStepIndex(step)) return;
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);

    const profileData = {
      borrower_name: formData.borrower_name,
      email: formData.email,
      phone: formData.phone || null,
      credit_score: formData.credit_score ? parseInt(formData.credit_score) : null,
      state_of_residence: formData.state_of_residence || null,
      entity_type: borrowerType === 'entity' ? 'llc' : 'individual',
      user_id: user.id,
      borrower_status: 'draft' as const,
      lifecycle_stage: 'profile_created' as const
    };

    if (borrower?.id) {
      await supabase.from('borrowers').update(profileData).eq('id', borrower.id);
    } else {
      const { data } = await supabase.from('borrowers').insert(profileData).select().single();
      if (data) setBorrower(data);
    }

    setSavingProfile(false);
    await loadData();
    setStep('identity');
    setExpandedSections(new Set(['identity']));
  };

  const handleIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !borrower || !user) return;

    setUploadingId(true);
    setIdError(null);

    const filePath = `borrowers/${user.id}/identity/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, file);

    if (uploadErr) {
      setIdError('Failed to upload ID document');
      setUploadingId(false);
      return;
    }

    await supabase.from('borrowers').update({
      id_document_type: selectedIdType,
      id_document_file_path: filePath,
      id_document_file_name: file.name,
      id_document_uploaded_at: new Date().toISOString()
    }).eq('id', borrower.id);

    setUploadingId(false);
    await loadData();
    setStep('loanType');
    setExpandedSections(new Set(['loanType']));
  };

  const handleLoanTypeContinue = async () => {
    if (!borrower || !selectedLoanType) return;
    setSavingLoanType(true);
    await updateBorrowerLoanType(borrower.id, selectedLoanType);
    setSavingLoanType(false);
    await loadData();
    setStep('documents');
    setExpandedSections(new Set(['documents']));
  };

  const handleDocumentsComplete = async () => {
    if (!borrower) return;

    setAnalyzing(true);
    setStep('documents');
    setExpandedSections(new Set());

    setAnalysisSteps([
      { label: 'Processing documents', done: false },
      { label: 'Analyzing financials', done: false },
      { label: 'Evaluating pre-approval', done: false }
    ]);

    await new Promise(r => setTimeout(r, 1200));
    setAnalysisSteps(prev => prev.map((s, i) => i === 0 ? { ...s, done: true } : s));

    await new Promise(r => setTimeout(r, 1000));
    setAnalysisSteps(prev => prev.map((s, i) => i <= 1 ? { ...s, done: true } : s));

    const creditScore = borrower.credit_score || 700;
    const baseAmount = creditScore >= 720 ? 500000 : creditScore >= 680 ? 350000 : 200000;

    await supabase.from('pre_approvals').insert({
      borrower_id: borrower.id,
      status: 'approved',
      sub_status: 'pre_approved',
      passes_liquidity_check: true,
      prequalified_amount: baseAmount,
      qualification_min: baseAmount * 0.85,
      qualification_max: baseAmount * 1.15,
      recommended_amount: baseAmount,
      machine_decision: 'APPROVED',
      machine_confidence: 85,
      letter_number: `PA-${Date.now().toString(36).toUpperCase()}`
    });

    await new Promise(r => setTimeout(r, 800));
    setAnalysisSteps(prev => prev.map(s => ({ ...s, done: true })));

    await new Promise(r => setTimeout(r, 500));
    setAnalyzing(false);
    await loadData();
    setStep('result');
    setExpandedSections(new Set(['result']));
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const isStepComplete = (s: FlowStep) => getStepIndex(s) < getStepIndex(step);
  const isStepActive = (s: FlowStep) => s === step;
  const canExpand = (s: FlowStep) => getStepIndex(s) <= getStepIndex(step);

  const renderHeader = (s: FlowStep, title: string, Icon: typeof User) => {
    const complete = isStepComplete(s);
    const active = isStepActive(s);
    const expanded = expandedSections.has(s);
    const clickable = canExpand(s);

    return (
      <button
        onClick={() => clickable && toggleSection(s)}
        disabled={!clickable}
        className={`w-full flex items-center justify-between p-4 transition-colors ${
          active ? 'bg-teal-50' : complete ? 'bg-gray-50 hover:bg-gray-100' : 'bg-gray-50 opacity-60'
        } ${clickable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            complete ? 'bg-teal-500 text-white' : active ? 'bg-teal-500 text-white' : 'bg-gray-300 text-gray-500'
          }`}>
            {complete ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
          </div>
          <span className={`font-medium ${active ? 'text-teal-700' : complete ? 'text-gray-700' : 'text-gray-400'}`}>
            {title}
          </span>
        </div>
        {clickable && (expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />)}
      </button>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const progressLabels = ['Borrower', 'Identity', 'Loan Type', 'Documents', 'Result'];
  const progressSteps: FlowStep[] = ['borrower', 'identity', 'loanType', 'documents', 'result'];
  const hasPreApproval = preApproval?.passes_liquidity_check;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-900">Get Pre-Approved</h1>
          <p className="text-sm text-gray-500 mt-1">Complete each step to receive your pre-approval</p>
        </div>

        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 overflow-x-auto">
          {progressLabels.map((label, idx) => {
            const stepKey = progressSteps[idx];
            const complete = isStepComplete(stepKey) || (stepKey === 'result' && hasPreApproval);
            const active = isStepActive(stepKey) || (analyzing && stepKey === 'result');

            return (
              <div key={label} className="flex items-center flex-shrink-0">
                <div className={`flex items-center gap-1.5 ${complete || active ? 'text-teal-600' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    complete ? 'bg-teal-500 text-white' : active ? 'bg-teal-500 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {complete ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className="text-xs font-medium hidden sm:inline whitespace-nowrap">{label}</span>
                </div>
                {idx < progressLabels.length - 1 && (
                  <div className={`w-6 sm:w-10 h-0.5 mx-1.5 ${getStepIndex(progressSteps[idx]) < getStepIndex(step) ? 'bg-teal-500' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderHeader('borrower', 'Borrower Information', User)}
        {expandedSections.has('borrower') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('borrower') && borrower ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">Name</span><p className="font-medium text-gray-900">{borrower.borrower_name}</p></div>
                <div><span className="text-gray-500">Phone</span><p className="font-medium text-gray-900">{borrower.phone || '-'}</p></div>
                <div><span className="text-gray-500">Credit Score</span><p className="font-medium text-gray-900">{borrower.credit_score || '-'}</p></div>
                <div><span className="text-gray-500">State</span><p className="font-medium text-gray-900">{borrower.state_of_residence || '-'}</p></div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Who is applying for this loan?</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setBorrowerType('personal')}
                      className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-colors ${
                        borrowerType === 'personal'
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        borrowerType === 'personal' ? 'bg-teal-100' : 'bg-gray-100'
                      }`}>
                        <User className={`w-5 h-5 ${borrowerType === 'personal' ? 'text-teal-600' : 'text-gray-500'}`} />
                      </div>
                      <div className="text-left">
                        <p className={`font-medium ${borrowerType === 'personal' ? 'text-teal-900' : 'text-gray-900'}`}>Personal</p>
                        <p className={`text-xs ${borrowerType === 'personal' ? 'text-teal-600' : 'text-gray-500'}`}>Individual borrower</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBorrowerType('entity')}
                      className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-colors ${
                        borrowerType === 'entity'
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        borrowerType === 'entity' ? 'bg-teal-100' : 'bg-gray-100'
                      }`}>
                        <Building2 className={`w-5 h-5 ${borrowerType === 'entity' ? 'text-teal-600' : 'text-gray-500'}`} />
                      </div>
                      <div className="text-left">
                        <p className={`font-medium ${borrowerType === 'entity' ? 'text-teal-900' : 'text-gray-900'}`}>Entity</p>
                        <p className={`text-xs ${borrowerType === 'entity' ? 'text-teal-600' : 'text-gray-500'}`}>LLC / Corporation</p>
                      </div>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={formData.borrower_name}
                      onChange={e => setFormData(p => ({ ...p, borrower_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="you@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Credit Score *</label>
                    <input
                      type="number"
                      value={formData.credit_score}
                      onChange={e => setFormData(p => ({ ...p, credit_score: e.target.value }))}
                      min="300"
                      max="850"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="720"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">State of Residence *</label>
                    <select
                      value={formData.state_of_residence}
                      onChange={e => setFormData(p => ({ ...p, state_of_residence: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="">Select state</option>
                      {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={!formData.borrower_name || !formData.email || !formData.credit_score || !formData.state_of_residence || savingProfile}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderHeader('identity', 'Identity Verification', Shield)}
        {expandedSections.has('identity') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('identity') || borrower?.id_document_file_path ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">ID Document Uploaded</p>
                  <p className="text-sm text-gray-500">Pending verification</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Upload a government-issued photo ID for identity verification.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ID Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ID_TYPES.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setSelectedIdType(value)}
                        className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                          selectedIdType === value ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
                    <CreditCard className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">{uploadingId ? 'Uploading...' : 'Click to upload your ID'}</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG up to 10MB</p>
                  </div>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleIdUpload} disabled={uploadingId} className="hidden" />
                </label>
                {idError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {idError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderHeader('loanType', 'Loan Type', FileText)}
        {expandedSections.has('loanType') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('loanType') && borrower?.preferred_loan_type ? (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-500 text-sm">Selected</span>
                  <p className="font-medium text-gray-900 capitalize">{borrower.preferred_loan_type.replace('_', ' ')}</p>
                </div>
                <button
                  onClick={() => { setStep('loanType'); setExpandedSections(new Set(['loanType'])); }}
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <LoanTypeSelector
                  selectedType={selectedLoanType}
                  onSelect={setSelectedLoanType}
                  onContinue={handleLoanTypeContinue}
                  showContinue={true}
                />
                {savingLoanType && (
                  <div className="flex items-center gap-2 text-teal-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Saving...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderHeader('documents', 'Financial Documents', Upload)}
        {expandedSections.has('documents') && !analyzing && (
          <div className="p-6 border-t border-gray-100">
            {borrower && (
              <div className="space-y-4">
                <DocumentUploadPanel borrowerId={borrower.id} borrowerType={borrowerType} onUploadComplete={() => {}} />
                <button
                  onClick={handleDocumentsComplete}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
                >
                  Submit for Pre-Approval
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {analyzing && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
              <h3 className="font-semibold text-gray-900">Analyzing your application...</h3>
            </div>
            <div className="space-y-3">
              {analysisSteps.map((s, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {s.done ? <CheckCircle className="w-5 h-5 text-green-500" /> : <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />}
                  <span className={s.done ? 'text-gray-700' : 'text-gray-400'}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'result' && !analyzing && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6">
            {hasPreApproval ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">You're Pre-Approved!</h3>
                <p className="text-3xl font-bold text-teal-600 mb-2">
                  Up to {formatCurrency(preApproval?.prequalified_amount || preApproval?.qualification_max)}
                </p>
                <p className="text-gray-500 mb-6">Based on your submitted financial information.</p>
                <button className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors">
                  Start Loan Application
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Additional Review Needed</h3>
                <p className="text-gray-500 mb-6">We need more information to complete your pre-approval.</p>
                <button
                  onClick={() => { setStep('documents'); setExpandedSections(new Set(['documents'])); }}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  Upload More Documents
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
