import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, ArrowLeft, Hop as Home, Building2, Upload, FileText, CheckCircle as CheckCircle2, User, DollarSign, Loader as Loader2, AlertCircle, AlertTriangle, Calendar, MapPin, Download, TrendingUp, Shield, Info, X, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { generatePreApprovalPdfHtml, downloadPdf, openPdfPreview } from '../../lib/pdfGenerator';
import { buildLoanPackage } from '../../services/loanPackagingEngine';
import { runPlacerBot } from '../../services/underwritingPipeline';
import { getSubmissionState } from '../../services/submissionStateService';
import { resolveApplicationStep, mapDocumentStatus } from '../../shared/utils';

type ApplicationStep =
  | 'loan-info'
  | 'property'
  | 'ownership'
  | 'documents'
  | 'processing'
  | 'liquidity'
  | 'pre-approval';

interface LoanProduct {
  id: string;
  name: string;
  description: string;
}

const LOAN_PRODUCTS: LoanProduct[] = [
  { id: 'dscr', name: 'DSCR / Rental Loan', description: 'Loan based on property rental income' },
  { id: 'fix_flip', name: 'Fix and Flip', description: 'Short-term loan for property renovation' },
  { id: 'bridge', name: 'Bridge Loan', description: 'Temporary financing before permanent loan' },
  { id: 'construction', name: 'Ground Up Construction', description: 'Build property from land' },
  { id: 'bank_statement', name: 'Bank Statement Loan', description: 'Qualify using bank deposits' },
  { id: 'commercial', name: 'Commercial', description: 'Commercial property financing' },
];

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family Home' },
  { value: 'multifamily', label: 'Multifamily (2-4 units)' },
  { value: 'multifamily_5plus', label: 'Multifamily (5+ units)' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhome', label: 'Townhome' },
  { value: 'mixed_use', label: 'Mixed Use' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  processingStatus?: string | null;
}

interface AccountData {
  bank_name: string;
  account_type: string;
  available_cash: number;
  closing_balance: number;
  opening_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  statement_period_start: string | null;
  statement_period_end: string | null;
}

interface ExtractedData {
  bank_accounts_found: number;
  months_of_data: number;
  total_available_cash: number;
  total_closing_balance: number;
  avg_monthly_deposits: number;
  avg_monthly_withdrawals: number;
  avg_monthly_cash: number;
  avg_monthly_net_flow: number;
  accounts: AccountData[];
}

interface PlacerBotCondition {
  category: string;
  condition: string;
  severity: 'requirement' | 'restriction' | 'note';
}

interface MatchedProgram {
  lender_name: string;
  program_name: string;
  fit_category: string;
  match_score: number;
  indicative_rate: number;
  blocking_reasons: string[];
  passing_criteria: string[];
  exception_opportunities: string[];
  overlays_triggered: string[];
  credit_tier_applied: { credit_range: string; max_ltv: number; max_loan_amount: number | null } | null;
  reserve_requirement_months: number;
}

interface PreApprovalResult {
  status: string;
  requested_loan_amount: number;
  verified_liquidity: number;
  required_liquidity: number;
  passes_liquidity_check: boolean;
  qualification_min: number;
  qualification_max: number;
  recommended_amount: number;
  conditions: string[];
  placerbot_conditions: PlacerBotCondition[];
  matched_programs: MatchedProgram[];
  best_program: MatchedProgram | null;
  indicative_rate_range: { min: number; max: number } | null;
  machine_decision: string;
  machine_confidence: number;
  letter_number: string;
}

interface NewLoanApplicationProps {
  onComplete: () => void;
  onCancel?: () => void;
  existingSubmissionId?: string | null;
  forceNew?: boolean;
}

export function NewLoanApplication({ onComplete, onCancel, existingSubmissionId, forceNew }: NewLoanApplicationProps) {
  const { user, userAccount } = useAuth();
  const [step, setStep] = useState<ApplicationStep>('loan-info');
  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(existingSubmissionId || null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [preApprovalResult, setPreApprovalResult] = useState<PreApprovalResult | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  const [applicationSaved, setApplicationSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmittingDocs, setIsSubmittingDocs] = useState(false);
  const [docsProcessed, setDocsProcessed] = useState(false);

  const [loanAmount, setLoanAmount] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [loanType, setLoanType] = useState('');
  const [loanPurpose, setLoanPurpose] = useState<'purchase' | 'refinance'>('purchase');
  const [creditScore, setCreditScore] = useState('720');
  const [estimatedDscr, setEstimatedDscr] = useState('');

  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyZip, setPropertyZip] = useState('');
  const [propertyType, setPropertyType] = useState('');

  const [ownershipType, setOwnershipType] = useState<'personal' | 'entity'>('personal');
  const [entityName, setEntityName] = useState('');

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);

  const formatInputCurrency = (value: string) => {
    const num = value.replace(/[^0-9]/g, '');
    if (!num) return '';
    return new Intl.NumberFormat('en-US').format(parseInt(num));
  };

  const parseCurrency = (value: string) => parseFloat(value.replace(/,/g, '')) || 0;

  const loanAmountNum = parseCurrency(loanAmount);
  const purchasePriceNum = parseCurrency(purchasePrice);
  const creditScoreNum = parseInt(creditScore) || 720;

  const calculateRequiredLiquidity = (amount: number) => {
    const estimatedRate = 0.08;
    const termMonths = 360;
    const monthlyPayment = amount > 0
      ? (amount * (estimatedRate / 12) * Math.pow(1 + estimatedRate / 12, termMonths)) / (Math.pow(1 + estimatedRate / 12, termMonths) - 1)
      : 0;
    return monthlyPayment * 4;
  };

  const requiredLiquidity = calculateRequiredLiquidity(loanAmountNum);

  useEffect(() => {
    const initializeApplication = async () => {
      if (!user) return;
      setIsInitializing(true);

      try {
        const { data: memberData } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        const userOrgId = memberData?.organization_id || null;
        setOrganizationId(userOrgId);

        let { data: borrower } = await supabase
          .from('borrowers')
          .select('id, organization_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!borrower) {
          const borrowerName = userAccount?.first_name && userAccount?.last_name
            ? `${userAccount.first_name} ${userAccount.last_name}`
            : user.email || 'Borrower';

          const { data: newBorrower } = await supabase.from('borrowers').insert({
            borrower_name: borrowerName,
            entity_type: 'individual',
            email: user.email,
            user_id: user.id,
            organization_id: userOrgId,
          }).select().single();

          borrower = newBorrower;
        } else if (!borrower.organization_id && userOrgId) {
          await supabase
            .from('borrowers')
            .update({ organization_id: userOrgId })
            .eq('id', borrower.id);
        }

        if (borrower) {
          setBorrowerId(borrower.id);

          if (existingSubmissionId) {
            const { data: existingSubmission } = await supabase
              .from('intake_submissions')
              .select(`
                *,
                loan_requests (requested_amount, loan_purpose),
                properties (address_street, address_city, address_state, address_zip, property_type, purchase_price)
              `)
              .eq('id', existingSubmissionId)
              .maybeSingle();

            if (existingSubmission) {
              setSubmissionId(existingSubmission.id);

              const loanReq = existingSubmission.loan_requests?.[0];
              if (loanReq) {
                if (loanReq.requested_amount) setLoanAmount(formatInputCurrency(String(loanReq.requested_amount)));
                if (loanReq.loan_purpose) setLoanType(loanReq.loan_purpose);
              }

              const prop = existingSubmission.properties?.[0];
              if (prop) {
                if (prop.address_street) setPropertyAddress(prop.address_street);
                if (prop.address_city) setPropertyCity(prop.address_city);
                if (prop.address_state) setPropertyState(prop.address_state);
                if (prop.address_zip) setPropertyZip(prop.address_zip);
                if (prop.property_type) setPropertyType(prop.property_type);
                if (prop.purchase_price) setPurchasePrice(formatInputCurrency(String(prop.purchase_price)));
              }

              const state = await getSubmissionState(existingSubmission.id);

              if (state.documents.length > 0) {
                setUploadedFiles(state.documents.map((d) => ({
                  id: d.id,
                  name: d.file_name,
                  type: 'bank_statement',
                  status: mapDocumentStatus(d.processing_status),
                  processingStatus: d.processing_status,
                })));
              }

              console.log('[NewLoanApplication:existing] FRESH doc statuses:', state.documents.map(d => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

              const loanReqAmount = existingSubmission.loan_requests?.[0]?.requested_amount || 0;
              const resolvedStep = resolveApplicationStep({
                documents: state.documents.map((d) => ({ id: d.id, processing_status: d.processing_status })),
                bankAccounts: state.bankAccounts,
                preApprovalResult: state.preApprovalResult,
                processingStage: existingSubmission.processing_stage,
                loanAmount: loanReqAmount,
              });

              setStep(resolvedStep);
            }
          } else if (!forceNew) {
            const { data: draftSubmission } = await supabase
              .from('intake_submissions')
              .select(`
                id,
                processing_stage,
                loan_requests (requested_amount, loan_purpose),
                properties (address_street, address_city, address_state, address_zip, property_type, purchase_price)
              `)
              .eq('user_id', user.id)
              .eq('status', 'draft')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (draftSubmission) {
              setSubmissionId(draftSubmission.id);

              const loanReq = draftSubmission.loan_requests?.[0];
              if (loanReq) {
                if (loanReq.requested_amount) setLoanAmount(formatInputCurrency(String(loanReq.requested_amount)));
                if (loanReq.loan_purpose) setLoanType(loanReq.loan_purpose);
              }

              const prop = draftSubmission.properties?.[0];
              if (prop) {
                if (prop.address_street) setPropertyAddress(prop.address_street);
                if (prop.address_city) setPropertyCity(prop.address_city);
                if (prop.address_state) setPropertyState(prop.address_state);
                if (prop.address_zip) setPropertyZip(prop.address_zip);
                if (prop.property_type) setPropertyType(prop.property_type);
                if (prop.purchase_price) setPurchasePrice(formatInputCurrency(String(prop.purchase_price)));
              }

              const state = await getSubmissionState(draftSubmission.id);

              if (state.documents.length > 0) {
                setUploadedFiles(state.documents.map((d) => ({
                  id: d.id,
                  name: d.file_name,
                  type: 'bank_statement',
                  status: mapDocumentStatus(d.processing_status),
                  processingStatus: d.processing_status,
                })));
              }

              console.log('[NewLoanApplication:draft] FRESH doc statuses:', state.documents.map(d => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

              const draftLoanAmount = draftSubmission.loan_requests?.[0]?.requested_amount || 0;
              const resolvedStep = resolveApplicationStep({
                documents: state.documents.map((d) => ({ id: d.id, processing_status: d.processing_status })),
                bankAccounts: state.bankAccounts,
                preApprovalResult: state.preApprovalResult,
                processingStage: draftSubmission.processing_stage,
                loanAmount: draftLoanAmount,
              });

              setStep(resolvedStep);
            }
          }
        }
      } catch (err) {
        console.error('Error initializing application:', err);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApplication();
  }, [user, userAccount, existingSubmissionId]);

  const STEPS: ApplicationStep[] = ['loan-info', 'property', 'ownership', 'documents', 'processing', 'liquidity', 'pre-approval'];

  const getStepIndex = (s: ApplicationStep) => STEPS.indexOf(s);

  const createDraftIfNeeded = useCallback(async () => {
    if (submissionId || !borrowerId || !user) return null;

    const { data: newSubmission } = await supabase
      .from('intake_submissions')
      .insert({
        borrower_id: borrowerId,
        user_id: user.id,
        organization_id: organizationId,
        status: 'draft',
        processing_stage: 'documents_uploading',
      })
      .select()
      .single();

    if (newSubmission) {
      setSubmissionId(newSubmission.id);
      return newSubmission.id;
    }
    return null;
  }, [submissionId, borrowerId, user, organizationId]);

  useEffect(() => {
    if (!borrowerId || isInitializing) return;

    const hasData = loanAmountNum > 0 || loanType || propertyAddress || propertyState || propertyType || purchasePriceNum > 0;
    if (!hasData) return;

    const autoSave = async () => {
      try {
        let currentSubmissionId = submissionId;
        if (!currentSubmissionId) {
          currentSubmissionId = await createDraftIfNeeded();
          if (!currentSubmissionId) return;
        }

        const { data: existingLoanRequest } = await supabase
          .from('loan_requests')
          .select('id')
          .eq('intake_submission_id', currentSubmissionId)
          .maybeSingle();

        if (existingLoanRequest) {
          await supabase
            .from('loan_requests')
            .update({
              requested_amount: loanAmountNum || null,
              loan_purpose: loanType || null,
            })
            .eq('id', existingLoanRequest.id);
        } else if (loanAmountNum > 0 || loanType) {
          await supabase.from('loan_requests').insert({
            intake_submission_id: currentSubmissionId,
            requested_amount: loanAmountNum || null,
            loan_purpose: loanType || null,
          });
        }

        const { data: existingProperty } = await supabase
          .from('properties')
          .select('id')
          .eq('intake_submission_id', currentSubmissionId)
          .maybeSingle();

        if (existingProperty) {
          await supabase
            .from('properties')
            .update({
              address_street: propertyAddress || null,
              address_city: propertyCity || null,
              address_state: propertyState || null,
              address_zip: propertyZip || null,
              property_type: propertyType || null,
              purchase_price: purchasePriceNum || null,
            })
            .eq('id', existingProperty.id);
        } else if (propertyAddress || propertyState || propertyType || purchasePriceNum > 0) {
          await supabase.from('properties').insert({
            intake_submission_id: currentSubmissionId,
            address_street: propertyAddress || null,
            address_city: propertyCity || null,
            address_state: propertyState || null,
            address_zip: propertyZip || null,
            property_type: propertyType || null,
            purchase_price: purchasePriceNum || null,
          });
        }

        if (ownershipType === 'entity' && entityName) {
          await supabase.from('borrowers').update({
            borrower_name: entityName,
            entity_type: 'llc',
          }).eq('id', borrowerId);
        }
      } catch (err) {
        console.error('Auto-save error:', err);
      }
    };

    const timeoutId = setTimeout(autoSave, 1000);
    return () => clearTimeout(timeoutId);
  }, [submissionId, borrowerId, isInitializing, loanAmountNum, loanType, propertyAddress, propertyCity, propertyState, propertyZip, propertyType, purchasePriceNum, ownershipType, entityName, createDraftIfNeeded]);

  const canProceed = (): boolean => {
    switch (step) {
      case 'loan-info':
        return loanAmount !== '' && purchasePrice !== '' && loanType !== '';
      case 'property':
        return propertyAddress !== '' && propertyState !== '' && propertyType !== '';
      case 'ownership':
        return ownershipType === 'personal' || entityName !== '';
      case 'documents':
        return uploadedFiles.filter(f => f.status === 'complete').length > 0;
      default:
        return true;
    }
  };

  const nextStep = () => {
    const currentIndex = getStepIndex(step);
    if (currentIndex < 3) {
      setStep(STEPS[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const currentIndex = getStepIndex(step);
    if (currentIndex > 0) {
      setStep(STEPS[currentIndex - 1]);
    }
  };

  const handleDeleteFile = useCallback(async (fileId: string, fileName: string) => {
    if (!user || !submissionId) return;
    const filePath = `${user.id}/${submissionId}/${fileId}-${fileName}`;
    await supabase.storage.from('borrower-documents').remove([filePath]);
    await supabase.from('uploaded_documents').delete().eq('id', fileId).eq('intake_submission_id', submissionId);
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  }, [user, submissionId]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    if (!borrowerId) {
      console.error('[Upload] borrower_id is missing - cannot upload documents');
      setUploadError('Unable to upload: your borrower profile was not found. Please refresh and try again.');
      return;
    }

    let currentSubmissionId = submissionId;
    if (!currentSubmissionId) {
      currentSubmissionId = await createDraftIfNeeded();
      if (!currentSubmissionId) return;
    }

    console.log('[Upload] Starting upload', { borrowerId, submissionId: currentSubmissionId, userId: user.id });
    setUploadError(null);
    let anySuccess = false;

    for (const file of Array.from(files)) {
      const fileId = crypto.randomUUID();
      setUploadedFiles(prev => [...prev, { id: fileId, name: file.name, type: 'bank_statement', status: 'uploading' }]);

      const filePath = `${user.id}/${currentSubmissionId}/${fileId}-${file.name}`;
      const { error: storageError } = await supabase.storage.from('borrower-documents').upload(filePath, file);

      if (storageError) {
        console.error('[Upload] Storage upload failed:', storageError);
        setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
        continue;
      }

      const { error: dbError } = await supabase.from('uploaded_documents').insert({
        intake_submission_id: currentSubmissionId,
        borrower_id: borrowerId,
        file_path: filePath,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        document_type: 'bank_statement',
        processing_status: 'pending',
      });

      if (dbError) {
        console.error('[Upload] DB insert failed:', dbError);
        setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
        continue;
      }

      console.log('[Upload] Document registered:', { fileId, filePath, borrowerId, submissionId: currentSubmissionId });
      setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'complete' } : f));
      anySuccess = true;
    }

    if (anySuccess && currentSubmissionId) {
      triggerAutoAnalysis(currentSubmissionId);
    }
  }, [submissionId, user, borrowerId, createDraftIfNeeded]);

  const buildExtractedData = useCallback((accounts: Record<string, unknown>[]): ExtractedData => {
    let totalAvailableCash = 0;
    let totalClosingBalance = 0;
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let totalCash = 0;
    const accountList: AccountData[] = [];

    for (const account of accounts) {
      const availableCash = parseFloat(String(account.available_cash || '0')) || parseFloat(String(account.closing_balance || '0')) || 0;
      const deposits = parseFloat(String(account.total_deposits || '0')) || 0;
      const withdrawals = parseFloat(String(account.total_withdrawals || '0')) || 0;
      const closingBalance = parseFloat(String(account.closing_balance || '0')) || 0;

      totalAvailableCash += availableCash;
      totalClosingBalance += closingBalance;
      totalDeposits += deposits;
      totalWithdrawals += withdrawals;
      totalCash += availableCash;

      accountList.push({
        bank_name: (account.bank_name as string) || 'Unknown Bank',
        account_type: (account.account_type as string) || 'checking',
        available_cash: availableCash,
        closing_balance: closingBalance,
        opening_balance: parseFloat(String(account.opening_balance || '0')) || 0,
        total_deposits: deposits,
        total_withdrawals: withdrawals,
        statement_period_start: account.statement_period_start as string | null,
        statement_period_end: account.statement_period_end as string | null,
      });
    }

    const monthCount = accounts.length;
    const avgDeposits = monthCount > 0 ? totalDeposits / monthCount : 0;
    const avgWithdrawals = monthCount > 0 ? totalWithdrawals / monthCount : 0;
    const avgCash = monthCount > 0 ? totalCash / monthCount : 0;

    return {
      bank_accounts_found: monthCount,
      months_of_data: monthCount,
      total_available_cash: totalAvailableCash,
      total_closing_balance: totalClosingBalance,
      avg_monthly_deposits: avgDeposits,
      avg_monthly_withdrawals: avgWithdrawals,
      avg_monthly_cash: avgCash,
      avg_monthly_net_flow: avgDeposits - avgWithdrawals,
      accounts: accountList,
    };
  }, []);

  useEffect(() => {
    if (!submissionId || step !== 'liquidity' || isInitializing) return;

    const refetchBankData = async () => {
      console.log('[NewLoanApp:liquidity:refetch] Fetching fresh bank data for submissionId:', submissionId);

      const { data: freshDocs } = await supabase
        .from('uploaded_documents')
        .select('id, processing_status')
        .eq('intake_submission_id', submissionId);

      console.log('[NewLoanApp:liquidity:refetch] Fresh doc statuses:', freshDocs?.map(d => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

      const { data: freshAccounts } = await supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', submissionId);

      console.log('LIQUIDITY FETCH DEBUG:', {
        bankAccounts: freshAccounts,
        length: freshAccounts?.length || 0,
      });

      if (freshAccounts && freshAccounts.length > 0) {
        setExtractedData(buildExtractedData(freshAccounts as Record<string, unknown>[]));
      } else {
        console.warn('[NewLoanApp:liquidity:refetch] No bank accounts found');
      }
    };

    refetchBankData();
  }, [submissionId, step, isInitializing, buildExtractedData]);

  const triggerAutoAnalysis = useCallback(async (targetSubmissionId: string) => {
    setStep('processing');
    setProcessingStatus('Uploading documents to processing engine...');

    try {
      const { data: existingAccounts } = await supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', targetSubmissionId);

      if (existingAccounts && existingAccounts.length > 0) {
        console.log('[AutoAnalysis] Bank data already exists — skipping processing');
        setExtractedData(buildExtractedData(existingAccounts as Record<string, unknown>[]));
        setStep('liquidity');
        return;
      }

      await supabase
        .from('intake_submissions')
        .update({ processing_stage: 'documents_processing' })
        .eq('id', targetSubmissionId);

      setProcessingStatus('Running OCR and document scanning...');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ submission_id: targetSubmissionId }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error('[AutoAnalysis] Edge function error:', response.status, errBody);
        setProcessingStatus('Processing encountered an issue. Checking results...');
      } else {
        const result = await response.json();
        console.log('[AutoAnalysis] Processing result:', result);
      }

      setProcessingStatus('Extracting financial data from statements...');

      const { data: accounts } = await supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', targetSubmissionId);

      if (!accounts || accounts.length === 0) {
        setProcessingStatus('Waiting for extraction to complete...');
        let retries = 0;
        const maxRetries = 12;
        const pollInterval = 3000;

        const poll = (): Promise<Record<string, unknown>[]> =>
          new Promise((resolve, reject) => {
            const timer = setInterval(async () => {
              retries++;
              const { data: polledAccounts } = await supabase
                .from('bank_statement_accounts')
                .select('*')
                .eq('intake_submission_id', targetSubmissionId);

              if (polledAccounts && polledAccounts.length > 0) {
                clearInterval(timer);
                resolve(polledAccounts as Record<string, unknown>[]);
              } else if (retries >= maxRetries) {
                clearInterval(timer);
                reject(new Error('Extraction timed out'));
              } else {
                const messages = [
                  'Scanning document pages...',
                  'Running optical character recognition...',
                  'Identifying account details...',
                  'Extracting transaction summaries...',
                  'Verifying financial figures...',
                  'Almost done...',
                ];
                setProcessingStatus(messages[Math.min(retries, messages.length - 1)]);
              }
            }, pollInterval);
          });

        try {
          const polledAccounts = await poll();
          setProcessingStatus('Analysis complete!');
          setExtractedData(buildExtractedData(polledAccounts));
          setStep('liquidity');
          return;
        } catch {
          setProcessingStatus('Could not extract data automatically. You may proceed manually.');
          setExtractedData(buildExtractedData([]));
          setTimeout(() => setStep('liquidity'), 1500);
          return;
        }
      }

      setProcessingStatus('Analysis complete!');
      setExtractedData(buildExtractedData(accounts as Record<string, unknown>[]));
      setStep('liquidity');
    } catch (error) {
      console.error('[AutoAnalysis] Error:', error);
      setProcessingStatus('Error processing documents. Please try again.');
      setTimeout(() => setStep('documents'), 2000);
    }
  }, [buildExtractedData]);

  const handleSubmitDocuments = useCallback(async () => {
    if (!submissionId || isSubmittingDocs) return;

    setIsSubmittingDocs(true);
    setProcessingStatus('Submitting documents for processing...');

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ submission_id: submissionId }),
      });

      if (!response.ok) {
        console.error('Document processing request failed');
        setProcessingStatus('Failed to submit documents. Please try again.');
        setIsSubmittingDocs(false);
        return;
      }

      setProcessingStatus('Processing documents...');

      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(r => setTimeout(r, 3000));

        const state = await getSubmissionState(submissionId);

        setUploadedFiles(state.documents.map((d) => ({
          id: d.id,
          name: d.file_name,
          type: 'bank_statement',
          status: mapDocumentStatus(d.processing_status),
          processingStatus: d.processing_status,
        })));

        const allDone = state.documents.length > 0 && state.documents.every((d) => {
          const s = (d.processing_status || '').toLowerCase();
          return ['completed', 'processed', 'failed', 'error'].includes(s);
        });

        if (allDone) {
          if (state.bankAccounts.length > 0) {
            setExtractedData(buildExtractedData(state.bankAccounts as unknown as Record<string, unknown>[]));
          }
          break;
        }
        setProcessingStatus(`Processing documents... (${attempt + 1}/15)`);
      }

      setDocsProcessed(true);
      setProcessingStatus('Documents processed successfully!');

    } catch (error) {
      console.error('Document processing error:', error);
      setProcessingStatus('Error processing documents. Please try again.');
    } finally {
      setIsSubmittingDocs(false);
    }
  }, [submissionId, isSubmittingDocs, buildExtractedData]);

  const runPreApproval = useCallback(async () => {
    if (!submissionId) return;

    const verifiedLiquidityForGuard = extractedData?.total_available_cash || 0;
    if (verifiedLiquidityForGuard < requiredLiquidity) {
      console.warn('Proceeding with liquidity shortfall flagged', {
        verified: verifiedLiquidityForGuard,
        required: requiredLiquidity
      });
    }

    setStep('processing');
    setProcessingStatus('Packaging loan data...');

    try {
      const loanPackage = await buildLoanPackage(submissionId, {
        loanAmount: loanAmountNum,
        purchasePrice: purchasePriceNum,
        loanType,
        propertyAddress,
        propertyCity,
        propertyState,
        propertyZip,
        borrowerType: ownershipType === 'entity' ? 'entity' : 'individual',
        creditScore: creditScoreNum,
        estimatedDscr: estimatedDscr ? parseFloat(estimatedDscr) : undefined,
        transactionType: loanPurpose === 'purchase' ? 'Purchase' : 'Refinance',
      });

      setProcessingStatus('Running pre-approval analysis with PlacerBot...');
      const result = await runPlacerBot(submissionId, loanPackage);
      setPreApprovalResult(result.pre_approval);

      console.log('PlacerBot completed:', {
        sub_status: result.pre_approval?.sub_status,
        passes_liquidity: result.pre_approval?.passes_liquidity_check,
        matched_programs: result.pre_approval?.matched_programs?.length
      });

      setStep('pre-approval');
    } catch {
      setProcessingStatus('Error running pre-approval. Please try again.');
      setTimeout(() => setStep('liquidity'), 2000);
    }
  }, [submissionId, loanAmountNum, purchasePriceNum, propertyAddress, propertyCity, propertyState, propertyZip, loanType, ownershipType, creditScoreNum, estimatedDscr, loanPurpose, extractedData, requiredLiquidity]);

  const handleExportPdf = useCallback(() => {
    if (!preApprovalResult) return;

    const borrowerName = ownershipType === 'entity' && entityName
      ? entityName
      : (userAccount?.first_name && userAccount?.last_name
          ? `${userAccount.first_name} ${userAccount.last_name}`
          : 'Borrower');

    const today = new Date();
    const expiration = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const pdfHtml = generatePreApprovalPdfHtml({
      borrowerName,
      borrowerType: ownershipType,
      entityName: entityName || undefined,
      loanAmount: preApprovalResult.recommended_amount,
      qualificationMin: preApprovalResult.qualification_min,
      qualificationMax: preApprovalResult.qualification_max,
      loanType,
      propertyAddress,
      propertyCity,
      propertyState,
      propertyZip,
      purchasePrice: purchasePriceNum,
      verifiedLiquidity: preApprovalResult.verified_liquidity,
      requiredLiquidity: preApprovalResult.required_liquidity,
      passesLiquidityCheck: preApprovalResult.passes_liquidity_check,
      conditions: preApprovalResult.conditions,
      placerBotConditions: preApprovalResult.placerbot_conditions.map(c => ({
        category: c.category,
        condition: c.condition,
        severity: c.severity,
      })),
      matchedPrograms: preApprovalResult.matched_programs.map(p => ({
        lenderName: p.lender_name,
        programName: p.program_name,
        fitCategory: p.fit_category,
        matchScore: p.match_score,
      })),
      issueDate: today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      expirationDate: expiration.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      letterNumber: preApprovalResult.letter_number,
    });

    downloadPdf(pdfHtml, `pre-approval-${preApprovalResult.letter_number}.pdf`);
  }, [preApprovalResult, ownershipType, entityName, userAccount, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum]);

  const handlePreviewPdf = useCallback(() => {
    if (!preApprovalResult) return;

    const borrowerName = ownershipType === 'entity' && entityName
      ? entityName
      : (userAccount?.first_name && userAccount?.last_name
          ? `${userAccount.first_name} ${userAccount.last_name}`
          : 'Borrower');

    const today = new Date();
    const expiration = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const pdfHtml = generatePreApprovalPdfHtml({
      borrowerName,
      borrowerType: ownershipType,
      entityName: entityName || undefined,
      loanAmount: preApprovalResult.recommended_amount,
      qualificationMin: preApprovalResult.qualification_min,
      qualificationMax: preApprovalResult.qualification_max,
      loanType,
      propertyAddress,
      propertyCity,
      propertyState,
      propertyZip,
      purchasePrice: purchasePriceNum,
      verifiedLiquidity: preApprovalResult.verified_liquidity,
      requiredLiquidity: preApprovalResult.required_liquidity,
      passesLiquidityCheck: preApprovalResult.passes_liquidity_check,
      conditions: preApprovalResult.conditions,
      placerBotConditions: preApprovalResult.placerbot_conditions.map(c => ({
        category: c.category,
        condition: c.condition,
        severity: c.severity,
      })),
      matchedPrograms: preApprovalResult.matched_programs.map(p => ({
        lenderName: p.lender_name,
        programName: p.program_name,
        fitCategory: p.fit_category,
        matchScore: p.match_score,
      })),
      issueDate: today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      expirationDate: expiration.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      letterNumber: preApprovalResult.letter_number,
    });

    openPdfPreview(pdfHtml);
  }, [preApprovalResult, ownershipType, entityName, userAccount, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum]);

  const handleSaveApplication = useCallback(async () => {
    if (!submissionId || !user) return;

    setIsSaving(true);
    try {
      const hasQualifyingLender = preApprovalResult?.has_qualifying_lender === true &&
        preApprovalResult?.sub_status === 'pre_approved' &&
        preApprovalResult?.letter_number !== null;

      const processingStage = hasQualifyingLender
        ? 'pre_approval_complete'
        : preApprovalResult?.sub_status === 'liquidity_review_required'
          ? 'liquidity_review_pending'
          : 'manual_review_pending';

      await supabase
        .from('intake_submissions')
        .update({
          status: 'pending_review',
          processing_stage: processingStage,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', submissionId);

      await supabase.from('loan_applications').insert({
        user_id: user.id,
        loan_type: loanType,
        loan_purpose: loanPurpose,
        property_state: propertyState,
        property_type: propertyType,
        borrower_type: ownershipType === 'entity' ? 'entity' : 'individual',
        current_stage: 'pre_approval_complete',
        requested_amount: loanAmountNum,
        pre_approval_status: 'approved',
        pre_approval_amount: preApprovalResult?.recommended_amount,
      });

      setApplicationSaved(true);
      setShowSaveModal(false);
    } catch (error) {
      console.error('Error saving application:', error);
    } finally {
      setIsSaving(false);
    }
  }, [submissionId, user, loanType, loanPurpose, propertyState, propertyType, ownershipType, loanAmountNum, preApprovalResult]);

  const renderProgressBar = () => {
    const displaySteps = [
      { key: 'loan-info', label: 'Loan' },
      { key: 'property', label: 'Property' },
      { key: 'ownership', label: 'Ownership' },
      { key: 'documents', label: 'Documents' },
      { key: 'liquidity', label: 'Liquidity' },
      { key: 'pre-approval', label: 'Pre-Approval' },
    ];

    const currentIndex = Math.min(
      getStepIndex(step),
      step === 'processing' ? getStepIndex('liquidity') - 1 : getStepIndex(step)
    );

    return (
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {displaySteps.map((s, i) => {
            const isComplete = i < currentIndex;
            const isCurrent = (step === 'processing' && i === 4) ||
                              (step !== 'processing' && displaySteps[i].key === step);

            return (
              <div key={s.key} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  isComplete ? 'bg-teal-600 text-white' :
                  isCurrent ? 'bg-teal-600 text-white ring-4 ring-teal-100' :
                  'bg-gray-200 text-gray-500'
                }`}>
                  {isComplete ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                </div>
                {i < displaySteps.length - 1 && (
                  <div className={`w-8 sm:w-16 h-0.5 ${i < currentIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          {displaySteps.map(s => (
            <span key={s.key} className="w-8 text-center">{s.label}</span>
          ))}
        </div>
      </div>
    );
  };

  if (isInitializing) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center py-16">
          <Loader2 className="w-16 h-16 text-teal-600 animate-spin mx-auto mb-6" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Application</h2>
          <p className="text-gray-600">Setting up your loan application...</p>
        </div>
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="max-w-3xl mx-auto">
        {renderProgressBar()}
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center py-16">
          <Loader2 className="w-16 h-16 text-teal-600 animate-spin mx-auto mb-6" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Processing</h2>
          <p className="text-gray-600">{processingStatus}</p>
        </div>
      </div>
    );
  }

  if (step === 'liquidity') {
    const verifiedLiquidity = extractedData?.total_available_cash || 0;
    const passesLiquidityCheck = verifiedLiquidity >= requiredLiquidity;
    const shortfall = requiredLiquidity - verifiedLiquidity;

    return (
      <div className="max-w-3xl mx-auto">
        {renderProgressBar()}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className={`px-8 py-6 ${passesLiquidityCheck ? 'bg-gradient-to-r from-green-600 to-green-700' : 'bg-gradient-to-r from-amber-500 to-amber-600'}`}>
            <div className="flex items-center gap-3">
              {passesLiquidityCheck ? (
                <CheckCircle2 className="w-8 h-8 text-white" />
              ) : (
                <AlertTriangle className="w-8 h-8 text-white" />
              )}
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {passesLiquidityCheck ? 'Liquidity Requirement Met!' : 'Liquidity Review Required'}
                </h2>
                <p className="text-white/80 mt-1">
                  {passesLiquidityCheck ? 'You have sufficient liquid assets' : 'Additional verification may be needed'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <div className={`rounded-xl p-6 ${passesLiquidityCheck ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
              <h3 className={`font-semibold mb-4 ${passesLiquidityCheck ? 'text-green-900' : 'text-amber-900'}`}>
                4x Liquidity Rule Check
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <p className={`text-sm mb-1 ${passesLiquidityCheck ? 'text-green-700' : 'text-amber-700'}`}>
                    Your Verified Cash
                  </p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(verifiedLiquidity)}</p>
                </div>
                <div className="text-center border-x border-gray-200">
                  <p className={`text-sm mb-1 ${passesLiquidityCheck ? 'text-green-700' : 'text-amber-700'}`}>
                    Required (4x Monthly)
                  </p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(requiredLiquidity)}</p>
                </div>
                <div className="text-center">
                  <p className={`text-sm mb-1 ${passesLiquidityCheck ? 'text-green-700' : 'text-amber-700'}`}>
                    Status
                  </p>
                  <p className={`text-2xl font-bold ${passesLiquidityCheck ? 'text-green-600' : 'text-amber-600'}`}>
                    {passesLiquidityCheck ? 'PASS' : 'REVIEW'}
                  </p>
                </div>
              </div>

              {!passesLiquidityCheck && (
                <div className="mt-4 pt-4 border-t border-amber-200">
                  <p className="text-amber-800">
                    You need an additional <span className="font-bold">{formatCurrency(shortfall)}</span> in verified liquid assets.
                  </p>
                </div>
              )}
            </div>

            {extractedData && extractedData.bank_accounts_found > 0 && (
              <>
                <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                  <div className="flex items-center gap-3 mb-4">
                    <Calendar className="w-6 h-6 text-gray-600" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      Bank Statement Analysis ({extractedData.months_of_data} Month{extractedData.months_of_data > 1 ? 's' : ''})
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-200">
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">Avg Monthly Deposits</span>
                      <span className="text-sm font-semibold text-green-600 tabular-nums">{formatCurrency(extractedData.avg_monthly_deposits)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">Avg Monthly Withdrawals</span>
                      <span className="text-sm font-semibold text-red-600 tabular-nums">{formatCurrency(extractedData.avg_monthly_withdrawals)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">Avg Monthly Balance</span>
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(extractedData.avg_monthly_cash)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">Net Cash Flow</span>
                      <span className={`text-sm font-semibold tabular-nums ${extractedData.avg_monthly_net_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(extractedData.avg_monthly_net_flow)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-900">Statement Details</h3>
                  {extractedData.accounts.map((account, idx) => {
                    const periodLabel = account.statement_period_start && account.statement_period_end
                      ? `${new Date(account.statement_period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(account.statement_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : `Statement ${idx + 1}`;
                    return (
                      <div key={idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-medium text-gray-900">{account.bank_name}</p>
                            <p className="text-sm text-gray-500">{periodLabel}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500">Available Cash</p>
                            <p className="text-lg font-semibold text-teal-700">{formatCurrency(account.available_cash)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div className="text-right">
                            <p className="text-gray-500">Opening</p>
                            <p className="font-medium tabular-nums">{formatCurrency(account.opening_balance)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-gray-500">Closing</p>
                            <p className="font-medium tabular-nums">{formatCurrency(account.closing_balance)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-gray-500">Deposits</p>
                            <p className="font-medium text-green-600 tabular-nums">{formatCurrency(account.total_deposits)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-gray-500">Withdrawals</p>
                            <p className="font-medium text-red-600 tabular-nums">{formatCurrency(account.total_withdrawals)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {(!extractedData || extractedData.bank_accounts_found === 0) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                <p className="text-amber-800">
                  No bank account data was extracted from your documents. This could happen if:
                </p>
                <ul className="mt-2 text-amber-700 text-sm list-disc list-inside space-y-1">
                  <li>The PDF is scanned or image-based</li>
                  <li>The bank statement format is not recognized</li>
                  <li>The document is not a bank statement</li>
                </ul>
              </div>
            )}

            {passesLiquidityCheck ? (
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <button
                  onClick={() => setStep('documents')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Upload More Documents
                </button>
                <button
                  onClick={runPreApproval}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  Generate Pre-Approval
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
                  <div className="flex items-start gap-4">
                    <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900 mb-1">Status: Pending Review</p>
                      <p className="font-medium text-amber-700 mb-3">Liquidity Review Required</p>
                      <p className="text-amber-800 mb-3">
                        Your verified liquid assets do not currently meet the minimum requirement for this loan scenario.
                      </p>
                      <p className="text-amber-700 text-sm">
                        Additional reserves or adjustments to the loan structure may be needed before proceeding.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h4 className="font-medium text-gray-900 mb-3">To proceed, consider:</h4>
                  <ul className="space-y-2 text-gray-700 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-1">-</span>
                      <span>Increasing liquid reserves by adding additional bank accounts</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-1">-</span>
                      <span>Reducing the loan amount to lower the monthly payment</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-1">-</span>
                      <span>Adjusting the purchase price</span>
                    </li>
                  </ul>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <button
                    onClick={() => setStep('documents')}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Upload More Documents
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep('loan-info')}
                      className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors"
                    >
                      Adjust Loan Terms
                    </button>
                    <button
                      onClick={runPreApproval}
                      className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                    >
                      Run Conditional Pre-Approval
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'pre-approval' && preApprovalResult) {
    const isConditional = preApprovalResult.sub_status !== 'pre_approved' || preApprovalResult.passes_liquidity_check === false;

    const loanTypeLabel = LOAN_PRODUCTS.find(l => l.id === loanType)?.name || loanType.replace(/_/g, ' ');
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const requirementConditions = preApprovalResult.placerbot_conditions.filter(c => c.severity === 'requirement');
    const restrictionConditions = preApprovalResult.placerbot_conditions.filter(c => c.severity === 'restriction');
    const noteConditions = preApprovalResult.placerbot_conditions.filter(c => c.severity === 'note');

    const getFitCategoryStyle = (category: string) => {
      switch (category) {
        case 'strong_fit': return 'bg-green-100 text-green-700';
        case 'good_fit': return 'bg-blue-100 text-blue-700';
        case 'conditional_fit': return 'bg-amber-100 text-amber-700';
        default: return 'bg-gray-100 text-gray-700';
      }
    };

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {renderProgressBar()}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className={`px-8 py-6 ${isConditional ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 'bg-gradient-to-r from-teal-600 to-teal-700'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {isConditional ? 'Conditional Pre-Approval' : 'Pre-Approval Letter'}
                </h2>
                <p className={isConditional ? 'text-amber-100 mt-1' : 'text-teal-100 mt-1'}>
                  Letter #{preApprovalResult.letter_number} | Issued: {today}
                  {isConditional && ' | Subject to conditions below'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreviewPdf}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={handleExportPdf}
                  className="px-4 py-2 bg-white text-teal-700 font-semibold rounded-lg hover:bg-teal-50 transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export PDF
                </button>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <div className="text-center border-b border-gray-200 pb-6">
              <p className="text-gray-600 mb-2">This letter confirms that</p>
              <p className="text-2xl font-bold text-gray-900 mb-2">
                {ownershipType === 'entity' && entityName ? entityName : (userAccount?.first_name && userAccount?.last_name ? `${userAccount.first_name} ${userAccount.last_name}` : 'Borrower')}
              </p>
              <p className="text-gray-600">is pre-approved for financing up to</p>
              <p className="text-4xl font-bold text-teal-600 my-4">
                {formatCurrency(preApprovalResult.recommended_amount)}
              </p>
              <p className="text-sm text-gray-500">
                Qualification Range: {formatCurrency(preApprovalResult.qualification_min)} - {formatCurrency(preApprovalResult.qualification_max)}
              </p>
            </div>

            {preApprovalResult.indicative_rate_range && (
              <div className="bg-gradient-to-r from-blue-50 to-teal-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                  <div>
                    <p className="font-medium text-gray-900">Indicative Rate Range</p>
                    <p className="text-lg font-bold text-blue-700">
                      {(preApprovalResult.indicative_rate_range.min * 100).toFixed(2)}% - {(preApprovalResult.indicative_rate_range.max * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">Loan Details</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Loan Type</span>
                    <span className="font-medium text-gray-900">{loanTypeLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Pre-Approved Amount</span>
                    <span className="font-medium text-gray-900">{formatCurrency(preApprovalResult.recommended_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Credit Score</span>
                    <span className="font-medium text-gray-900">{creditScoreNum}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Borrower Type</span>
                    <span className="font-medium text-gray-900 capitalize">{ownershipType}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">Property</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">{propertyAddress}</p>
                      <p className="text-sm text-gray-600">{propertyCity}, {propertyState} {propertyZip}</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-gray-200 mt-2">
                    <span className="text-gray-600">Purchase Price</span>
                    <span className="font-medium text-gray-900">{formatCurrency(purchasePriceNum)}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gray-600">LTV</span>
                    <span className="font-medium text-gray-900">{((loanAmountNum / purchasePriceNum) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900">Financial Verification</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Verified Liquidity</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(preApprovalResult.verified_liquidity)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Required</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(preApprovalResult.required_liquidity)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Status</p>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      preApprovalResult.passes_liquidity_check ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {preApprovalResult.passes_liquidity_check ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {preApprovalResult.matched_programs.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-teal-600" />
                  Program Eligibility (PlacerBot)
                </h3>
                <div className="space-y-3">
                  {preApprovalResult.matched_programs.slice(0, 3).map((program, idx) => (
                    <div key={idx} className={`border rounded-lg p-4 ${program.blocking_reasons.length === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-gray-900">{program.lender_name}</p>
                          <p className="text-sm text-gray-600">{program.program_name}</p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getFitCategoryStyle(program.fit_category)}`}>
                            {program.fit_category.replace('_', ' ')}
                          </span>
                          <p className="text-sm text-gray-500 mt-1">Score: {program.match_score}</p>
                        </div>
                      </div>
                      {program.credit_tier_applied && (
                        <div className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2">
                          Credit Tier: {program.credit_tier_applied.credit_range} | Max LTV: {(program.credit_tier_applied.max_ltv * 100).toFixed(0)}%
                          {program.credit_tier_applied.max_loan_amount && ` | Max Loan: ${formatCurrency(program.credit_tier_applied.max_loan_amount)}`}
                        </div>
                      )}
                      {program.indicative_rate > 0 && (
                        <p className="text-sm text-teal-700 font-medium mt-1">
                          Indicative Rate: {(program.indicative_rate * 100).toFixed(2)}%
                        </p>
                      )}
                      {(program.passing_criteria?.length > 0 || program.blocking_reasons.length > 0) && (
                        <div className="border-t border-gray-200 pt-3 mt-3 space-y-1.5">
                          {program.passing_criteria?.length > 0 && (
                            <div className="mb-2">
                              <p className="text-xs font-medium text-green-700 mb-1">What you meet:</p>
                              {program.passing_criteria.map((criterion, cIdx) => (
                                <div key={`p-${cIdx}`} className="flex items-start gap-2 text-xs text-green-700">
                                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                  <span>{criterion}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {program.blocking_reasons.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-amber-600 mb-1">Criteria not met:</p>
                              {program.blocking_reasons.map((reason, rIdx) => (
                                <div key={`b-${rIdx}`} className="flex items-start gap-2 text-xs text-amber-600">
                                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                  <span>{reason}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {requirementConditions.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-xl p-6">
                <h3 className="font-semibold text-red-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Required Prior to Funding
                </h3>
                <ul className="space-y-2">
                  {requirementConditions.map((condition, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-red-800 text-sm">
                      <span className="w-5 h-5 bg-red-200 text-red-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">
                        {idx + 1}
                      </span>
                      {condition.condition}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border border-amber-200 bg-amber-50 rounded-xl p-6">
              <h3 className="font-semibold text-amber-900 mb-4">Pre-Approved Subject To:</h3>
              <ul className="space-y-2">
                {preApprovalResult.conditions.map((condition, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-amber-800 text-sm">
                    <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">
                      {idx + 1}
                    </span>
                    {condition}
                  </li>
                ))}
                {restrictionConditions.map((condition, idx) => (
                  <li key={`r-${idx}`} className="flex items-start gap-2 text-amber-800 text-sm">
                    <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">
                      {preApprovalResult.conditions.length + idx + 1}
                    </span>
                    {condition.condition}
                  </li>
                ))}
              </ul>
            </div>

            {noteConditions.length > 0 && (
              <div className="border border-blue-200 bg-blue-50 rounded-xl p-6">
                <h3 className="font-semibold text-blue-900 mb-4 flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  Additional Notes
                </h3>
                <ul className="space-y-2">
                  {noteConditions.map((condition, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-blue-800 text-sm">
                      <span className="w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">
                        {idx + 1}
                      </span>
                      {condition.condition}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-gray-100 rounded-lg p-4 text-sm text-gray-600">
              <p className="mb-2">
                <strong>Valid Until:</strong> {expirationDate}
              </p>
              <p>
                This pre-approval is based on information provided and is subject to verification. Final approval is contingent upon satisfactory completion of all conditions listed above.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => setStep('liquidity')}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={handlePreviewPdf}
                  className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Preview Letter
                </button>
                <button
                  onClick={handleExportPdf}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>

        {!applicationSaved && (
          <div className="bg-gradient-to-r from-teal-50 to-emerald-50 rounded-2xl border border-teal-200 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center">
                  <Save className="w-6 h-6 text-teal-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Save Your Application</h3>
                  <p className="text-sm text-gray-600">
                    Save to your account to track progress and continue later.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSaveModal(true)}
                className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
              >
                <Save className="w-5 h-5" />
                Save Application
              </button>
            </div>
          </div>
        )}

        {applicationSaved && (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-900">Application Saved!</h3>
                <p className="text-sm text-green-700">
                  Your pre-approval has been saved. You can view it anytime in your Loan Applications.
                </p>
              </div>
              <button
                onClick={onComplete}
                className="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
              >
                View Applications
              </button>
            </div>
          </div>
        )}

        {showSaveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">Save Application</h3>
                  <button
                    onClick={() => setShowSaveModal(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Loan Type</p>
                      <p className="font-medium text-gray-900">{loanTypeLabel}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Amount</p>
                      <p className="font-medium text-gray-900">{formatCurrency(preApprovalResult.recommended_amount)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Property</p>
                      <p className="font-medium text-gray-900 truncate">{propertyCity}, {propertyState}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Status</p>
                      <span className="inline-flex px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                        Pre-Approved
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-gray-600 text-sm mb-6">
                  Saving this application will add it to your Loan Applications where you can track its progress.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSaveModal(false)}
                    className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Not Now
                  </button>
                  <button
                    onClick={handleSaveApplication}
                    disabled={isSaving}
                    className="flex-1 px-4 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-5 h-5" />
                        Save Application
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const selectedProduct = LOAN_PRODUCTS.find(p => p.id === loanType);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Loan Application</h1>
        <p className="text-gray-600 mt-1">Get pre-approved in minutes</p>
      </div>

      {renderProgressBar()}

      <div className="bg-white rounded-2xl shadow-lg p-8">
        {step === 'loan-info' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Loan Details</h2>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <button
                onClick={() => setLoanPurpose('purchase')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  loanPurpose === 'purchase'
                    ? 'border-teal-600 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Home className={`w-6 h-6 mb-2 ${loanPurpose === 'purchase' ? 'text-teal-600' : 'text-gray-400'}`} />
                <h3 className="font-semibold text-gray-900">Purchase</h3>
                <p className="text-sm text-gray-500">Buying a property</p>
              </button>

              <button
                onClick={() => setLoanPurpose('refinance')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  loanPurpose === 'refinance'
                    ? 'border-teal-600 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <DollarSign className={`w-6 h-6 mb-2 ${loanPurpose === 'refinance' ? 'text-teal-600' : 'text-gray-400'}`} />
                <h3 className="font-semibold text-gray-900">Refinance</h3>
                <p className="text-sm text-gray-500">Refinancing existing property</p>
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Desired Loan Amount <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="text"
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(formatInputCurrency(e.target.value))}
                    placeholder="500,000"
                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {loanPurpose === 'purchase' ? 'Purchase Price' : 'Property Value'} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="text"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(formatInputCurrency(e.target.value))}
                    placeholder="650,000"
                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Credit Score (estimated)
                </label>
                <input
                  type="number"
                  value={creditScore}
                  onChange={(e) => setCreditScore(e.target.value)}
                  placeholder="720"
                  min="300"
                  max="850"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Estimated DSCR (for rental properties)
                </label>
                <input
                  type="text"
                  value={estimatedDscr}
                  onChange={(e) => setEstimatedDscr(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="1.25"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Loan Type <span className="text-red-500">*</span>
              </label>
              <div className="grid md:grid-cols-2 gap-3">
                {LOAN_PRODUCTS.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setLoanType(product.id)}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      loanType === product.id
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`font-medium ${loanType === product.id ? 'text-teal-700' : 'text-gray-900'}`}>
                      {product.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">{product.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {loanAmountNum > 0 && purchasePriceNum > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-500">LTV</p>
                    <p className="text-lg font-semibold text-gray-900">{((loanAmountNum / purchasePriceNum) * 100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Down Payment</p>
                    <p className="text-lg font-semibold text-gray-900">{formatCurrency(purchasePriceNum - loanAmountNum)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Required Liquidity</p>
                    <p className="text-lg font-semibold text-teal-600">{formatCurrency(requiredLiquidity)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'property' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Property Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Address <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                placeholder="123 Main Street"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
                <input
                  type="text"
                  value={propertyCity}
                  onChange={(e) => setPropertyCity(e.target.value)}
                  placeholder="City"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">State <span className="text-red-500">*</span></label>
                <select
                  value={propertyState}
                  onChange={(e) => setPropertyState(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Select</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">ZIP Code</label>
                <input
                  type="text"
                  value={propertyZip}
                  onChange={(e) => setPropertyZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="12345"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Type <span className="text-red-500">*</span></label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Select property type</option>
                {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 'ownership' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Ownership Structure</h2>
            <p className="text-gray-600">How will you be taking title to this property?</p>

            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => setOwnershipType('personal')}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  ownershipType === 'personal'
                    ? 'border-teal-600 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <User className={`w-8 h-8 mb-3 ${ownershipType === 'personal' ? 'text-teal-600' : 'text-gray-400'}`} />
                <h3 className="font-semibold text-gray-900">Personal Name</h3>
                <p className="text-sm text-gray-500 mt-1">Title in your personal name</p>
              </button>

              <button
                onClick={() => setOwnershipType('entity')}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  ownershipType === 'entity'
                    ? 'border-teal-600 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Building2 className={`w-8 h-8 mb-3 ${ownershipType === 'entity' ? 'text-teal-600' : 'text-gray-400'}`} />
                <h3 className="font-semibold text-gray-900">Entity / LLC</h3>
                <p className="text-sm text-gray-500 mt-1">Title in an entity name</p>
              </button>
            </div>

            {ownershipType === 'entity' && (
              <div className="space-y-4 pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Entity Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                    placeholder="ABC Holdings LLC"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'documents' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Upload Bank Statements</h2>
            <p className="text-gray-600">Upload your last 2 months of bank statements to verify liquidity</p>

            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-3">Your Loan Request Summary</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Loan Amount</p>
                  <p className="font-semibold text-gray-900">{formatCurrency(loanAmountNum)}</p>
                </div>
                <div>
                  <p className="text-gray-500">{loanPurpose === 'purchase' ? 'Purchase Price' : 'Property Value'}</p>
                  <p className="font-semibold text-gray-900">{formatCurrency(purchasePriceNum)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Loan Type</p>
                  <p className="font-semibold text-gray-900">{selectedProduct?.name || loanType}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  {propertyAddress}, {propertyCity}, {propertyState} {propertyZip}
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900">Required: Last 2 Months Bank Statements</p>
                  <p className="text-sm text-amber-700 mt-1">
                    Upload PDF bank statements to verify liquidity for pre-approval.
                  </p>
                </div>
              </div>
            </div>

            {uploadError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                  <p className="text-sm text-red-700">{uploadError}</p>
                </div>
              </div>
            )}

            <p className="text-sm text-gray-500">
              Documents will be analyzed automatically after upload.
            </p>

            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-teal-400 transition-colors">
              <input
                type="file"
                id="bank-statements"
                multiple
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
              <label htmlFor="bank-statements" className="cursor-pointer">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900 mb-1">Drop files here or click to upload</p>
                <p className="text-sm text-gray-500">PDF bank statements (last 2 months minimum)</p>
              </label>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-gray-900">Uploaded Files</h3>
                {uploadedFiles.map(file => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <span className="text-sm text-gray-700">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {file.status === 'uploading' && <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />}
                      {file.status === 'processing' && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />}
                      {file.status === 'complete' && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                      {file.status === 'error' && <AlertCircle className="w-5 h-5 text-red-600" />}
                      {file.status !== 'uploading' && file.status !== 'processing' && (
                        <button
                          onClick={() => handleDeleteFile(file.id, file.name)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Remove file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isSubmittingDocs && processingStatus && (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
                <span className="text-teal-800">{processingStatus}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4">
              {uploadedFiles.length > 0 && !docsProcessed && !isSubmittingDocs && (
                <button
                  onClick={handleSubmitDocuments}
                  disabled={isSubmittingDocs}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Documents
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
              {isSubmittingDocs && (
                <button
                  disabled
                  className="px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg flex items-center gap-2 opacity-70 cursor-not-allowed"
                >
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </button>
              )}
              {docsProcessed && !isSubmittingDocs && (
                <button
                  onClick={() => setStep('liquidity')}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
              {uploadedFiles.length === 0 && !isSubmittingDocs && (
                <button
                  disabled
                  className="px-6 py-3 bg-gray-300 text-gray-500 font-semibold rounded-lg cursor-not-allowed flex items-center gap-2"
                >
                  Upload Documents First
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
          <button
            onClick={prevStep}
            disabled={step === 'loan-info' || isSubmittingDocs}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          {step !== 'documents' && (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
