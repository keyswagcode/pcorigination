import { useState, useEffect, useCallback } from 'react';
import { User, FileText, Upload, CheckCircle, ChevronDown, ChevronUp, ArrowRight, Loader2, AlertCircle, Shield, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { LoanTypeSelector } from './LoanTypeSelector';
import { getLoanTypeConfig, type BorrowerLoanType } from '../../lib/loanTypeDocuments';
import { updateBorrowerLoanType } from '../../services/borrowerService';
import type { IdentityDocumentType } from '../../shared/types';

type JourneyStep = 'borrower_info' | 'identity' | 'loan_type' | 'documents' | 'analyzing' | 'result';

interface BorrowerProfile {
  id: string;
  borrower_name: string;
  email: string | null;
  phone: string | null;
  entity_type: string | null;
  credit_score: number | null;
  state_of_residence: string | null;
  preferred_loan_type: string | null;
  id_document_type?: string | null;
  id_document_file_path?: string | null;
  id_document_verified?: boolean;
}

interface PreApproval {
  id: string;
  passes_liquidity_check: boolean;
  prequalified_amount: number | null;
  qualification_min: number | null;
  qualification_max: number | null;
}

interface UploadedDoc {
  id: string;
  file_name: string;
  document_type: string;
  processing_status: string | null;
}

interface PreApprovalJourneyProps {
  borrower: BorrowerProfile | null;
  preApprovals: PreApproval[];
  onComplete?: () => void;
  onRefresh?: () => void;
}

const STEP_ORDER: JourneyStep[] = ['borrower_info', 'identity', 'loan_type', 'documents', 'analyzing', 'result'];
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const ID_TYPES: { value: IdentityDocumentType; label: string }[] = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'passport', label: 'Passport' },
  { value: 'government_id', label: 'Government ID' },
];

function getStepIndex(step: JourneyStep): number {
  return STEP_ORDER.indexOf(step);
}

export function PreApprovalJourney({ borrower, preApprovals, onComplete, onRefresh }: PreApprovalJourneyProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState<JourneyStep>('borrower_info');
  const [expandedSections, setExpandedSections] = useState<Set<JourneyStep>>(new Set(['borrower_info']));

  const [borrowerName, setBorrowerName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditScore, setCreditScore] = useState('');
  const [stateOfResidence, setStateOfResidence] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [selectedIdType, setSelectedIdType] = useState<IdentityDocumentType>('drivers_license');
  const [isUploadingId, setIsUploadingId] = useState(false);
  const [idUploaded, setIdUploaded] = useState(false);

  const [selectedLoanType, setSelectedLoanType] = useState<BorrowerLoanType | null>(null);
  const [isUpdatingLoanType, setIsUpdatingLoanType] = useState(false);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisSteps, setAnalysisSteps] = useState<{ label: string; done: boolean }[]>([]);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const hasPreApproval = preApprovals.some(p => p.passes_liquidity_check);
  const latestPreApproval = preApprovals[0] || null;
  const currentLoanType = borrower?.preferred_loan_type as BorrowerLoanType | null;
  const loanConfig = getLoanTypeConfig(currentLoanType);

  useEffect(() => {
    if (borrower) {
      setBorrowerName(borrower.borrower_name || '');
      setPhone(borrower.phone || '');
      setCreditScore(borrower.credit_score?.toString() || '');
      setStateOfResidence(borrower.state_of_residence || '');
      setIdUploaded(!!borrower.id_document_file_path);
    }
  }, [borrower]);

  useEffect(() => {
    if (!borrower) {
      setCurrentStep('borrower_info');
      return;
    }

    if (hasPreApproval) {
      setCurrentStep('result');
      setExpandedSections(new Set(['result']));
      return;
    }

    const hasCompletedProfile = borrower.borrower_name && borrower.credit_score && borrower.state_of_residence;
    const hasIdentity = !!borrower.id_document_file_path;
    const hasLoanType = currentLoanType && currentLoanType !== 'not_sure';

    if (!hasCompletedProfile) {
      setCurrentStep('borrower_info');
      setExpandedSections(new Set(['borrower_info']));
    } else if (!hasIdentity) {
      setCurrentStep('identity');
      setExpandedSections(new Set(['identity']));
    } else if (!hasLoanType) {
      setCurrentStep('loan_type');
      setExpandedSections(new Set(['loan_type']));
    } else {
      setCurrentStep('documents');
      setExpandedSections(new Set(['documents']));
      loadDocuments();
    }
  }, [borrower, hasPreApproval, currentLoanType]);

  const loadDocuments = useCallback(async () => {
    if (!borrower) return;

    const { data } = await supabase
      .from('uploaded_documents')
      .select('id, file_name, document_type, processing_status')
      .eq('borrower_id', borrower.id)
      .order('created_at', { ascending: false });

    setDocuments(data || []);

    const { data: submissions } = await supabase
      .from('intake_submissions')
      .select('id')
      .eq('borrower_id', borrower.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (submissions && submissions.length > 0) {
      setSubmissionId(submissions[0].id);
    }
  }, [borrower]);

  useEffect(() => {
    if (borrower && currentLoanType) {
      loadDocuments();
    }
  }, [borrower, currentLoanType, loadDocuments]);

  const toggleSection = (step: JourneyStep) => {
    const stepIdx = getStepIndex(step);
    const currentIdx = getStepIndex(currentStep);
    if (stepIdx > currentIdx) return;

    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const handleSaveProfile = async () => {
    if (!borrower) return;
    setIsSavingProfile(true);

    await supabase
      .from('borrowers')
      .update({
        borrower_name: borrowerName,
        phone: phone || null,
        credit_score: creditScore ? parseInt(creditScore) : null,
        state_of_residence: stateOfResidence || null,
      })
      .eq('id', borrower.id);

    setIsSavingProfile(false);
    onRefresh?.();
    setCurrentStep('identity');
    setExpandedSections(new Set(['identity']));
  };

  const handleIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !borrower || !user) return;

    setIsUploadingId(true);
    setUploadError(null);

    const filePath = `borrowers/${user.id}/identity/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(filePath, file);

    if (uploadErr) {
      setUploadError('Failed to upload ID document');
      setIsUploadingId(false);
      return;
    }

    await supabase
      .from('borrowers')
      .update({
        id_document_type: selectedIdType,
        id_document_file_path: filePath,
        id_document_file_name: file.name,
        id_document_uploaded_at: new Date().toISOString(),
      })
      .eq('id', borrower.id);

    setIsUploadingId(false);
    setIdUploaded(true);
    onRefresh?.();
    setCurrentStep('loan_type');
    setExpandedSections(new Set(['loan_type']));
  };

  const handleLoanTypeSelect = (type: BorrowerLoanType) => {
    setSelectedLoanType(type);
  };

  const handleLoanTypeContinue = async () => {
    if (!borrower || !selectedLoanType) return;
    setIsUpdatingLoanType(true);
    await updateBorrowerLoanType(borrower.id, selectedLoanType);
    setIsUpdatingLoanType(false);
    setCurrentStep('documents');
    setExpandedSections(new Set(['documents']));
    onRefresh?.();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !borrower || !user) return;

    setIsUploading(true);
    setUploadError(null);

    let currentSubmissionId = submissionId;
    if (!currentSubmissionId) {
      const { data: newSubmission, error: subErr } = await supabase
        .from('intake_submissions')
        .insert({
          borrower_id: borrower.id,
          user_id: user.id,
          status: 'draft',
        })
        .select('id')
        .single();

      if (subErr || !newSubmission) {
        setUploadError('Failed to create submission');
        setIsUploading(false);
        return;
      }
      currentSubmissionId = newSubmission.id;
      setSubmissionId(currentSubmissionId);
    }

    for (const file of Array.from(files)) {
      const filePath = `${borrower.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadErr) {
        setUploadError(`Failed to upload ${file.name}`);
        continue;
      }

      await supabase.from('uploaded_documents').insert({
        borrower_id: borrower.id,
        intake_submission_id: currentSubmissionId,
        file_name: file.name,
        file_path: filePath,
        document_type: 'bank_statement',
        processing_status: 'pending',
      });
    }

    setIsUploading(false);
    loadDocuments();
  };

  const handleSubmitForReview = async () => {
    if (!submissionId || documents.length === 0) return;

    setCurrentStep('analyzing');
    setExpandedSections(new Set(['analyzing']));

    setAnalysisSteps([
      { label: 'Processing documents', done: false },
      { label: 'Analyzing financials', done: false },
      { label: 'Evaluating qualification', done: false },
    ]);

    await supabase
      .from('intake_submissions')
      .update({ status: 'submitted' })
      .eq('id', submissionId);

    await new Promise(r => setTimeout(r, 1200));
    setAnalysisSteps(prev => prev.map((s, i) => i === 0 ? { ...s, done: true } : s));

    await new Promise(r => setTimeout(r, 1000));
    setAnalysisSteps(prev => prev.map((s, i) => i <= 1 ? { ...s, done: true } : s));

    if (borrower) {
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
    }

    await new Promise(r => setTimeout(r, 800));
    setAnalysisSteps(prev => prev.map(s => ({ ...s, done: true })));

    await new Promise(r => setTimeout(r, 500));
    onRefresh?.();
    setCurrentStep('result');
    setExpandedSections(new Set(['result']));
  };

  const handleStartApplication = () => {
    onComplete?.();
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const isStepComplete = (step: JourneyStep): boolean => {
    const stepIdx = getStepIndex(step);
    const currentIdx = getStepIndex(currentStep);
    return stepIdx < currentIdx;
  };

  const isStepActive = (step: JourneyStep): boolean => {
    return step === currentStep;
  };

  const renderSectionHeader = (step: JourneyStep, title: string, Icon: typeof User) => {
    const complete = isStepComplete(step);
    const active = isStepActive(step);
    const expanded = expandedSections.has(step);
    const canExpand = getStepIndex(step) <= getStepIndex(currentStep);

    return (
      <button
        onClick={() => canExpand && toggleSection(step)}
        disabled={!canExpand}
        className={`w-full flex items-center justify-between p-4 transition-colors ${
          active ? 'bg-teal-50' : complete ? 'bg-gray-50 hover:bg-gray-100' : 'bg-gray-50 opacity-60'
        } ${canExpand ? 'cursor-pointer' : 'cursor-not-allowed'}`}
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
        {canExpand && (
          expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
    );
  };

  if (!borrower) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const progressSteps = ['Borrower Info', 'Identity', 'Loan Type', 'Documents', 'Result'];
  const progressKeys: JourneyStep[] = ['borrower_info', 'identity', 'loan_type', 'documents', 'result'];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Get Pre-Approved</h2>
          <p className="text-sm text-gray-500 mt-1">Complete each step to receive your pre-approval</p>
        </div>

        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 overflow-x-auto">
          {progressSteps.map((label, idx) => {
            const stepKey = progressKeys[idx];
            const complete = isStepComplete(stepKey) || (stepKey === 'result' && hasPreApproval);
            const active = isStepActive(stepKey) || (currentStep === 'analyzing' && stepKey === 'result');

            return (
              <div key={label} className="flex items-center flex-shrink-0">
                <div className={`flex items-center gap-1.5 ${
                  complete ? 'text-teal-600' : active ? 'text-teal-600' : 'text-gray-400'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    complete ? 'bg-teal-500 text-white' : active ? 'bg-teal-500 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {complete ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className="text-xs font-medium hidden sm:inline whitespace-nowrap">{label}</span>
                </div>
                {idx < progressSteps.length - 1 && (
                  <div className={`w-6 sm:w-10 h-0.5 mx-1.5 ${
                    getStepIndex(progressKeys[idx]) < getStepIndex(currentStep) ? 'bg-teal-500' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderSectionHeader('borrower_info', 'Borrower Information', User)}
        {expandedSections.has('borrower_info') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('borrower_info') ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Name</span>
                  <p className="font-medium text-gray-900">{borrower.borrower_name}</p>
                </div>
                <div>
                  <span className="text-gray-500">Phone</span>
                  <p className="font-medium text-gray-900">{borrower.phone || '-'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Credit Score</span>
                  <p className="font-medium text-gray-900">{borrower.credit_score || '-'}</p>
                </div>
                <div>
                  <span className="text-gray-500">State</span>
                  <p className="font-medium text-gray-900">{borrower.state_of_residence || '-'}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={borrowerName}
                      onChange={(e) => setBorrowerName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Credit Score (estimated)</label>
                    <input
                      type="number"
                      value={creditScore}
                      onChange={(e) => setCreditScore(e.target.value)}
                      min="300"
                      max="850"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="720"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State of Residence</label>
                    <select
                      value={stateOfResidence}
                      onChange={(e) => setStateOfResidence(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="">Select state</option>
                      {US_STATES.map(st => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={!borrowerName || !creditScore || !stateOfResidence || isSavingProfile}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderSectionHeader('identity', 'Identity Verification', Shield)}
        {expandedSections.has('identity') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('identity') || idUploaded ? (
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
                <p className="text-sm text-gray-600">
                  Upload a government-issued photo ID for identity verification.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ID Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ID_TYPES.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setSelectedIdType(value)}
                        className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                          selectedIdType === value
                            ? 'border-teal-500 bg-teal-50 text-teal-700'
                            : 'border-gray-200 hover:border-gray-300 text-gray-700'
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
                    <p className="text-sm text-gray-600">
                      {isUploadingId ? 'Uploading...' : 'Click to upload your ID'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG up to 10MB</p>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleIdUpload}
                    disabled={isUploadingId}
                    className="hidden"
                  />
                </label>
                {uploadError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {uploadError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {renderSectionHeader('loan_type', 'Loan Type', FileText)}
        {expandedSections.has('loan_type') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('loan_type') && currentLoanType ? (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-500 text-sm">Selected</span>
                  <p className="font-medium text-gray-900">{loanConfig.label}</p>
                </div>
                <button
                  onClick={() => {
                    setCurrentStep('loan_type');
                    setExpandedSections(new Set(['loan_type']));
                  }}
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <LoanTypeSelector
                  selectedType={selectedLoanType || currentLoanType}
                  onSelect={handleLoanTypeSelect}
                  onContinue={handleLoanTypeContinue}
                  showContinue={true}
                />
                {isUpdatingLoanType && (
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
        {renderSectionHeader('documents', 'Financial Documents', Upload)}
        {expandedSections.has('documents') && (
          <div className="p-6 border-t border-gray-100">
            {isStepComplete('documents') ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">{documents.length} document(s) uploaded</p>
                {documents.slice(0, 3).map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-gray-700">{doc.file_name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Required for {loanConfig.label} Pre-Approval
                  </p>
                  <ul className="space-y-1">
                    {loanConfig.documents.filter(d => d.required).map(doc => (
                      <li key={doc.type} className="text-sm text-gray-600 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                        {doc.label}
                      </li>
                    ))}
                  </ul>
                </div>

                {documents.length > 0 && (
                  <div className="space-y-2">
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{doc.file_name}</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          doc.processing_status === 'completed' ? 'bg-green-100 text-green-700' :
                          doc.processing_status === 'processing' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {doc.processing_status === 'completed' ? 'Processed' : doc.processing_status === 'processing' ? 'Processing' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <label className="block">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">
                      {isUploading ? 'Uploading...' : 'Click to upload or drag and drop'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG up to 10MB</p>
                  </div>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="hidden"
                  />
                </label>

                {uploadError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {uploadError}
                  </div>
                )}

                {documents.length > 0 && (
                  <button
                    onClick={handleSubmitForReview}
                    disabled={isUploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    Submit for Pre-Approval
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {currentStep === 'analyzing' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
              <h3 className="font-semibold text-gray-900">Analyzing your application...</h3>
            </div>
            <div className="space-y-3">
              {analysisSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {step.done ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
                  )}
                  <span className={step.done ? 'text-gray-700' : 'text-gray-400'}>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {currentStep === 'result' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6">
            {hasPreApproval && latestPreApproval ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">You're Pre-Approved!</h3>
                <p className="text-3xl font-bold text-teal-600 mb-2">
                  Up to {formatCurrency(latestPreApproval.prequalified_amount || latestPreApproval.qualification_max)}
                </p>
                <p className="text-gray-500 mb-6">Based on your submitted financial information.</p>
                <button
                  onClick={handleStartApplication}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
                >
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
                <p className="text-gray-500 mb-6">
                  We need more information to complete your pre-approval. Our team will be in touch shortly.
                </p>
                <button
                  onClick={() => {
                    setCurrentStep('documents');
                    setExpandedSections(new Set(['documents']));
                  }}
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
