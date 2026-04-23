import { useState, useCallback, useEffect } from 'react';
import { Upload, DollarSign, MapPin, Building2, ArrowRight, CheckCircle, XCircle, AlertTriangle, Loader as Loader2, FileText, Calendar, Hop as Home, User, ArrowLeft, Download, TrendingUp, Shield, Info, FileCheck, Bot } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../team/TeamContext';
import { generatePreApprovalPdfHtml, downloadPdf, openPdfPreview, fetchOrgBrandingForBorrower } from '../../lib/pdfGenerator';
import { buildLoanPackage } from '../../services/loanPackagingEngine';
import { runPlacerBot } from '../../services/underwritingPipeline';
import { getSubmissionState } from '../../services/submissionStateService';
import {
  resolveFlowStep,
  isDocumentProcessed as isDocProcessed,
  isDocumentProcessing as isDocProcessing,
  isDocumentFailed as isDocFailed,
  isValidBankAccount as isValidBankAccountLib,
  mapDocumentStatus,
} from '../../shared/utils';

type FlowStep = 'loan_info' | 'upload' | 'processing' | 'liquidity_check' | 'result';

interface UploadedFile {
  id: string;
  name: string;
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
  near_misses?: string[];
  salvage_suggestions?: { field: string; current_value: string; required_value: string; fix: string }[];
  exception_opportunities: string[];
  overlays_triggered: string[];
  credit_tier_applied: { credit_range: string; max_ltv: number; max_loan_amount: number | null } | null;
  reserve_requirement_months: number;
  eligible?: boolean;
}

interface PreApprovalResult {
  status: string;
  sub_status?: string;
  requested_loan_amount: number;
  verified_liquidity: number;
  required_liquidity: number;
  passes_liquidity_check: boolean;
  qualification_min: number | null;
  qualification_max: number | null;
  recommended_amount: number | null;
  conditions: string[];
  placerbot_conditions: PlacerBotCondition[];
  matched_programs: MatchedProgram[];
  best_program: MatchedProgram | null;
  indicative_rate_range: { min: number; max: number } | null;
  machine_decision: string;
  machine_confidence: number;
  letter_number: string | null;
  has_qualifying_lender?: boolean;
  has_viable_path?: boolean;
  eligible_lender_path?: string | null;
}

const LOAN_TYPES = [
  { value: 'dscr', label: 'DSCR Loan', description: 'Debt Service Coverage Ratio loan for rental properties' },
  { value: 'bank_statement', label: 'Bank Statement', description: 'Income verified through bank statements' },
  { value: 'bridge', label: 'Bridge Loan', description: 'Short-term financing between transactions' },
  { value: 'fix_flip', label: 'Fix & Flip', description: 'Short-term loan for property renovation' },
  { value: 'construction', label: 'Construction', description: 'Financing for new construction projects' },
  { value: 'commercial', label: 'Commercial', description: 'Commercial property financing' },
];

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

type BankAccountRow = {
  bank_name: string;
  account_type: string;
  available_cash: number | null;
  closing_balance: number | null;
  opening_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
};

function isValidBankAccount(acc: BankAccountRow): boolean {
  return isValidBankAccountLib(acc);
}

function buildExtractedDataFromAccounts(accounts: BankAccountRow[]): ExtractedData {
  let totalAvailableCash = 0;
  let totalClosingBalance = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalCash = 0;
  const accountList: AccountData[] = [];
  const monthCount = accounts.length;

  for (const account of accounts) {
    const availableCash = parseFloat(String(account.available_cash)) || parseFloat(String(account.closing_balance)) || 0;
    const deposits = parseFloat(String(account.total_deposits)) || 0;
    const withdrawals = parseFloat(String(account.total_withdrawals)) || 0;
    const closingBalance = parseFloat(String(account.closing_balance)) || 0;
    totalAvailableCash += availableCash;
    totalClosingBalance += closingBalance;
    totalDeposits += deposits;
    totalWithdrawals += withdrawals;
    totalCash += availableCash;
    accountList.push({
      bank_name: account.bank_name || 'Unknown Bank',
      account_type: account.account_type || 'checking',
      available_cash: availableCash,
      closing_balance: closingBalance,
      opening_balance: parseFloat(String(account.opening_balance)) || 0,
      total_deposits: deposits,
      total_withdrawals: withdrawals,
      statement_period_start: account.statement_period_start,
      statement_period_end: account.statement_period_end,
    });
  }

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
}

interface PreApprovalFlowProps {
  forceNew?: boolean;
  existingSubmissionId?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

export function PreApprovalFlow({ forceNew = false, existingSubmissionId, onComplete, onCancel }: PreApprovalFlowProps = {}) {
  const { user, userAccount } = useAuth();
  const { organization } = useTeam();
  const [step, setStep] = useState<FlowStep>('loan_info');
  const [lockedStep, setLockedStep] = useState<FlowStep | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [submissionId, setSubmissionId] = useState<string | null>(existingSubmissionId || null);
  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [preApprovalResult, setPreApprovalResult] = useState<PreApprovalResult | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  const [applicationSaved, setApplicationSaved] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [bankDataExists, setBankDataExists] = useState(false);
  const [rawBankAccounts, setRawBankAccounts] = useState<BankAccountRow[]>([]);
  const [docsProcessed, setDocsProcessed] = useState(false);
  const [isSubmittingDocs, setIsSubmittingDocs] = useState(false);

  const [desiredLoanAmount, setDesiredLoanAmount] = useState('');
  const [estimatedPurchasePrice, setEstimatedPurchasePrice] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyZip, setPropertyZip] = useState('');
  const [loanType, setLoanType] = useState('');
  const [borrowerType, setBorrowerType] = useState<'individual' | 'entity'>('individual');
  const [entityName, setEntityName] = useState('');
  const [creditScore, setCreditScore] = useState('720');
  const [estimatedDscr, setEstimatedDscr] = useState('');
  const [idDocumentType, setIdDocumentType] = useState<'drivers_license' | 'passport'>('drivers_license');
  const [idDocumentNumber, setIdDocumentNumber] = useState('');
  const [idDocumentState, setIdDocumentState] = useState('');
  const [idDocumentCountry, setIdDocumentCountry] = useState('US');
  const [idDocumentExpiration, setIdDocumentExpiration] = useState('');
  const [isForeignNational, setIsForeignNational] = useState(false);
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);
  const [idDocumentUploading, setIdDocumentUploading] = useState(false);
  const [idDocumentUploaded, setIdDocumentUploaded] = useState(false);
  const [idDocumentFileName, setIdDocumentFileName] = useState('');

  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);

  const formatInputCurrency = (value: string) => {
    const num = value.replace(/[^0-9]/g, '');
    if (!num) return '';
    return new Intl.NumberFormat('en-US').format(parseInt(num));
  };

  const parseCurrency = (value: string) => parseFloat(value.replace(/,/g, '')) || 0;

  const loanAmountNum = parseCurrency(desiredLoanAmount);
  const purchasePriceNum = parseCurrency(estimatedPurchasePrice);
  const creditScoreNum = parseInt(creditScore) || 720;

  const calculateRequiredLiquidity = (loanAmount: number) => {
    const estimatedRate = 0.08;
    const termMonths = 360;
    const monthlyPayment = loanAmount > 0
      ? (loanAmount * (estimatedRate / 12) * Math.pow(1 + estimatedRate / 12, termMonths)) / (Math.pow(1 + estimatedRate / 12, termMonths) - 1)
      : 0;
    return monthlyPayment * 4;
  };

  const requiredLiquidity = calculateRequiredLiquidity(loanAmountNum);

  const isIdDocumentComplete = idDocumentNumber && idDocumentExpiration && (idDocumentType === 'passport' || idDocumentState) && idDocumentUploaded;
  const isLoanInfoComplete = desiredLoanAmount && estimatedPurchasePrice && propertyAddress && propertyCity && propertyState && loanType && isIdDocumentComplete;

  const updateStep = useCallback((newStep: FlowStep) => {
    if (lockedStep) return;
    setStep(newStep);
    if (submissionId) {
      sessionStorage.setItem(`preapproval_step_${submissionId}`, newStep);
    }
  }, [submissionId, lockedStep]);

  const saveStepProgress = useCallback(async (newStep: FlowStep, processingStage: string, currentSubmissionId?: string) => {
    const idToUse = currentSubmissionId || submissionId;
    updateStep(newStep);
    if (!idToUse) {
      console.error('Cannot save step progress: no submission ID');
      return;
    }

    try {
      await supabase
        .from('intake_submissions')
        .update({ processing_stage: processingStage })
        .eq('id', idToUse);

      if (processingStage === 'loan_info_complete') {
        const { data: existingLoanRequest } = await supabase
          .from('loan_requests')
          .select('id')
          .eq('intake_submission_id', idToUse)
          .maybeSingle();

        if (existingLoanRequest) {
          await supabase
            .from('loan_requests')
            .update({
              requested_amount: loanAmountNum || null,
              loan_purpose: loanType || null,
            })
            .eq('id', existingLoanRequest.id);
        } else {
          await supabase.from('loan_requests').insert({
            intake_submission_id: idToUse,
            requested_amount: loanAmountNum || null,
            loan_purpose: loanType || null,
          });
        }

        const { data: existingProperty } = await supabase
          .from('properties')
          .select('id')
          .eq('intake_submission_id', idToUse)
          .maybeSingle();

        if (existingProperty) {
          await supabase
            .from('properties')
            .update({
              address_street: propertyAddress || null,
              address_city: propertyCity || null,
              address_state: propertyState || null,
              address_zip: propertyZip || null,
              purchase_price: purchasePriceNum || null,
            })
            .eq('id', existingProperty.id);
        } else if (propertyAddress || propertyState || purchasePriceNum > 0) {
          await supabase.from('properties').insert({
            intake_submission_id: idToUse,
            address_street: propertyAddress || null,
            address_city: propertyCity || null,
            address_state: propertyState || null,
            address_zip: propertyZip || null,
            purchase_price: purchasePriceNum || null,
          });
        }
      }
    } catch (err) {
      console.error('Error saving step progress:', err);
    }
  }, [submissionId, updateStep, loanAmountNum, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum]);

  useEffect(() => {
    let cancelled = false;

    const loadExistingSubmission = async (id: string) => {
      setIsInitializing(true);
      try {
        const { data: borrowerData } = await supabase
          .from('borrowers')
          .select('id')
          .eq('user_id', user!.id)
          .maybeSingle();

        if (borrowerData) {
          setBorrowerId(borrowerData.id);
        }

        const { data: submission } = await supabase
          .from('intake_submissions')
          .select(`
            *,
            loan_requests (requested_amount, loan_purpose),
            properties (address_street, address_city, address_state, address_zip, property_type, purchase_price)
          `)
          .eq('id', id)
          .maybeSingle();

        if (cancelled || !submission) {
          setIsInitializing(false);
          return;
        }

        setSubmissionId(id);

        const loanReq = submission.loan_requests?.[0];
        if (loanReq) {
          if (loanReq.requested_amount) setDesiredLoanAmount(formatInputCurrency(String(loanReq.requested_amount)));
          if (loanReq.loan_purpose) setLoanType(loanReq.loan_purpose);
        }

        const prop = submission.properties?.[0];
        if (prop) {
          if (prop.address_street) setPropertyAddress(prop.address_street);
          if (prop.address_city) setPropertyCity(prop.address_city);
          if (prop.address_state) setPropertyState(prop.address_state);
          if (prop.address_zip) setPropertyZip(prop.address_zip);
          if (prop.purchase_price) setEstimatedPurchasePrice(formatInputCurrency(String(prop.purchase_price)));
        }

        const state = await getSubmissionState(id);

        if (state.documents.length > 0) {
          setFiles(state.documents.map((d) => ({
            id: d.id,
            name: d.file_name,
            status: mapDocumentStatus(d.processing_status),
            processingStatus: d.processing_status,
          })));
        }

        console.log('[resume:loadExisting] FRESH doc statuses:', state.documents.map((d) => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

        const validBankAccounts = state.bankAccounts.filter(isValidBankAccount);

        if (validBankAccounts.length > 0) {
          setDocsProcessed(true);
          setBankDataExists(true);
          setRawBankAccounts(validBankAccounts as BankAccountRow[]);
          setExtractedData(buildExtractedDataFromAccounts(validBankAccounts as BankAccountRow[]));
        }

        const existingLoanAmount = submission.loan_requests?.[0]?.requested_amount
          ? parseFloat(String(submission.loan_requests[0].requested_amount))
          : 0;

        const effectiveStep = resolveFlowStep({
          documents: state.documents.map((d) => ({
            id: d.id,
            processing_status: d.processing_status,
          })),
          bankAccounts: validBankAccounts,
          loanAmount: existingLoanAmount,
          preApprovalResult:
            state.preApprovalResult?.sub_status === 'pre_approved'
              ? state.preApprovalResult
              : null,
        });

        console.log('[resume:loadExisting] resolveFlowStep result:', effectiveStep, {
          docsCount: state.documents.length,
          docStatuses: state.documents.map(d => d.processing_status),
          validBankAccountsCount: validBankAccounts.length,
          loanAmount: existingLoanAmount,
          hasPreApproval: !!state.preApprovalResult?.status,
        });
        if (!lockedStep) {
          setStep(effectiveStep);
        }
      } catch (err) {
        console.error('Error loading submission:', err);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    const initializeApplication = async () => {
      if (!user) return;

      if (existingSubmissionId) {
        await loadExistingSubmission(existingSubmissionId);
        return;
      }

      if (submissionId) return;
      setIsInitializing(true);

      try {
        const { data: borrowerData } = await supabase
          .from('borrowers')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        let borrower = borrowerData;

        if (!borrower) {
          const borrowerName = userAccount?.first_name && userAccount?.last_name
            ? `${userAccount.first_name} ${userAccount.last_name}`
            : user.email || 'Borrower';

          const { data: newBorrower } = await supabase.from('borrowers').insert({
            borrower_name: borrowerName,
            entity_type: 'individual',
            email: user.email,
            user_id: user.id,
            ...(organization ? { organization_id: organization.id } : {}),
          }).select().single();

          borrower = newBorrower;
        }

        if (cancelled || !borrower) return;
        setBorrowerId(borrower.id);

        if (!forceNew) {
          const { data: existingDraft } = await supabase
            .from('intake_submissions')
            .select(`
              *,
              loan_requests (requested_amount, loan_purpose),
              properties (address_street, address_city, address_state, address_zip, property_type, purchase_price)
            `)
            .eq('user_id', user.id)
            .eq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (cancelled) return;

          if (existingDraft) {
            setSubmissionId(existingDraft.id);

            const loanReq = existingDraft.loan_requests?.[0];
            if (loanReq) {
              if (loanReq.requested_amount) setDesiredLoanAmount(formatInputCurrency(String(loanReq.requested_amount)));
              if (loanReq.loan_purpose) setLoanType(loanReq.loan_purpose);
            }

            const prop = existingDraft.properties?.[0];
            if (prop) {
              if (prop.address_street) setPropertyAddress(prop.address_street);
              if (prop.address_city) setPropertyCity(prop.address_city);
              if (prop.address_state) setPropertyState(prop.address_state);
              if (prop.address_zip) setPropertyZip(prop.address_zip);
              if (prop.purchase_price) setEstimatedPurchasePrice(formatInputCurrency(String(prop.purchase_price)));
            }

            const state = await getSubmissionState(existingDraft.id);

            if (state.documents.length > 0) {
              setFiles(state.documents.map((d) => ({
                id: d.id,
                name: d.file_name,
                status: mapDocumentStatus(d.processing_status),
                processingStatus: d.processing_status,
              })));
            }

            const hasDraftDocs = state.documents.length > 0;
            const allDraftDocsProcessed = hasDraftDocs && state.documents.every(
              (d) => isDocProcessed(d.processing_status)
            );

            console.log('[resume:draft] FRESH doc statuses:', state.documents.map((d) => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

            const validDraftBankAccounts = state.bankAccounts.filter(isValidBankAccount);
            if (allDraftDocsProcessed && validDraftBankAccounts.length > 0) {
              setDocsProcessed(true);
              setBankDataExists(true);
              setExtractedData(buildExtractedDataFromAccounts(validDraftBankAccounts as BankAccountRow[]));
            }

            const draftLoanAmount = existingDraft.loan_requests?.[0]?.requested_amount
              ? parseFloat(String(existingDraft.loan_requests[0].requested_amount))
              : 0;

            const effectiveDraftStep = resolveFlowStep({
              documents: state.documents.map((d) => ({
                id: d.id,
                processing_status: d.processing_status,
              })),
              bankAccounts: validDraftBankAccounts,
              loanAmount: draftLoanAmount,
              preApprovalResult:
                state.preApprovalResult?.sub_status === 'pre_approved'
                  ? state.preApprovalResult
                  : null,
            });

            console.log('[resume:draft] chosen step:', effectiveDraftStep);
            if (!lockedStep) {
              setStep(effectiveDraftStep);
            }
            setIsInitializing(false);
            return;
          }
        }

        {
          if (cancelled) return;
          const { data: newSubmission } = await supabase
            .from('intake_submissions')
            .insert({
              borrower_id: borrower.id,
              user_id: user.id,
              status: 'draft',
              processing_stage: 'documents_uploading',
              ...(organization ? { organization_id: organization.id } : {}),
            })
            .select()
            .single();

          if (newSubmission && !cancelled) {
            setSubmissionId(newSubmission.id);
          }
        }
      } catch (err) {
        console.error('Error initializing application:', err);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    initializeApplication();
    return () => { cancelled = true; };
  }, [user, existingSubmissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!submissionId || step !== 'liquidity_check' || isInitializing) return;

    const refetchBankData = async () => {
      console.log('[liquidity_check:refetch] Fetching fresh bank data for submissionId:', submissionId);

      const { data: freshDocs } = await supabase
        .from('uploaded_documents')
        .select('id, processing_status')
        .eq('intake_submission_id', submissionId);

      console.log('[liquidity_check:refetch] Fresh doc statuses:', freshDocs?.map(d => ({ id: d.id?.slice(0, 8), status: d.processing_status })));

      const { data: freshAccounts } = await supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', submissionId);

      const validAccounts = (freshAccounts || []).filter(isValidBankAccount);

      console.log('LIQUIDITY FETCH DEBUG:', {
        bankAccounts: validAccounts,
        length: validAccounts.length,
      });

      if (validAccounts.length > 0) {
        setRawBankAccounts(validAccounts);
        setBankDataExists(true);
        setExtractedData(buildExtractedDataFromAccounts(validAccounts));
        setDocsProcessed(true);
      } else {
        console.warn('[liquidity_check:refetch] No valid bank accounts found, redirecting to upload');
        updateStep('upload');
      }
    };

    refetchBankData();
  }, [submissionId, step, isInitializing, updateStep]);

  useEffect(() => {
    if (!submissionId || !borrowerId || isInitializing) return;

    const autoSave = async () => {
      try {
        const { data: existingLoanRequest } = await supabase
          .from('loan_requests')
          .select('id')
          .eq('intake_submission_id', submissionId)
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
            intake_submission_id: submissionId,
            requested_amount: loanAmountNum || null,
            loan_purpose: loanType || null,
          });
        }

        const { data: existingProperty } = await supabase
          .from('properties')
          .select('id')
          .eq('intake_submission_id', submissionId)
          .maybeSingle();

        if (existingProperty) {
          await supabase
            .from('properties')
            .update({
              address_street: propertyAddress || null,
              address_city: propertyCity || null,
              address_state: propertyState || null,
              address_zip: propertyZip || null,
              purchase_price: purchasePriceNum || null,
            })
            .eq('id', existingProperty.id);
        } else if (propertyAddress || propertyState) {
          await supabase.from('properties').insert({
            intake_submission_id: submissionId,
            address_street: propertyAddress || null,
            address_city: propertyCity || null,
            address_state: propertyState || null,
            address_zip: propertyZip || null,
            purchase_price: purchasePriceNum || null,
          });
        }

        const borrowerUpdate: Record<string, unknown> = {
          id_document_type: idDocumentType,
          id_document_number: idDocumentNumber || null,
          id_document_state: idDocumentType === 'drivers_license' ? idDocumentState : null,
          id_document_country: idDocumentCountry,
          id_document_expiration: idDocumentExpiration || null,
        };

        if (borrowerType === 'entity' && entityName) {
          borrowerUpdate.borrower_name = entityName;
          borrowerUpdate.entity_type = 'llc';
        }

        await supabase.from('borrowers').update(borrowerUpdate).eq('id', borrowerId);
      } catch (err) {
        console.error('Auto-save error:', err);
      }
    };

    const timeoutId = setTimeout(autoSave, 1000);
    return () => clearTimeout(timeoutId);
  }, [submissionId, borrowerId, isInitializing, loanAmountNum, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum, borrowerType, entityName, idDocumentType, idDocumentNumber, idDocumentState, idDocumentCountry, idDocumentExpiration]);

  const handleIdDocumentUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !borrowerId) return;

    setIdDocumentFile(file);
    setIdDocumentUploading(true);

    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const filePath = `${user.id}/${borrowerId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('id-documents')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      await supabase.from('borrowers').update({
        id_document_file_path: filePath,
        id_document_file_name: file.name,
        id_document_uploaded_at: new Date().toISOString(),
        foreign_national: isForeignNational,
      }).eq('id', borrowerId);

      setIdDocumentUploaded(true);
      setIdDocumentFileName(file.name);
    } catch (err) {
      console.error('ID document upload error:', err);
      setIdDocumentFile(null);
    } finally {
      setIdDocumentUploading(false);
    }
  }, [user, borrowerId, isForeignNational]);

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

      let accounts: BankAccountRow[] | null = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(r => setTimeout(r, 3000));

        const state = await getSubmissionState(submissionId);

        setFiles(state.documents.map((d) => ({
          id: d.id,
          name: d.file_name,
          status: mapDocumentStatus(d.processing_status),
          processingStatus: d.processing_status,
        })));

        const allDone = state.documents.length > 0 && state.documents.every((d) =>
          isDocProcessed(d.processing_status) || isDocFailed(d.processing_status)
        );

        if (allDone) {
          const validAccounts = state.bankAccounts.filter(acc => isValidBankAccountLib(acc));
          accounts = validAccounts as unknown as BankAccountRow[];
          break;
        }
        setProcessingStatus(`Processing documents... (${attempt + 1}/15)`);
      }

      if (!accounts) {
        const state = await getSubmissionState(submissionId);
        accounts = state.bankAccounts.filter(acc => isValidBankAccountLib(acc)) as unknown as BankAccountRow[];
      }

      if (accounts.length > 0) {
        setExtractedData(buildExtractedDataFromAccounts(accounts));
        setRawBankAccounts(accounts);
        setDocsProcessed(true);
        setBankDataExists(true);
        setProcessingStatus('Documents processed successfully!');
      } else {
        setProcessingStatus('Processing complete. Click Continue when ready.');
        setDocsProcessed(true);
      }

    } catch (error) {
      console.error('Document processing error:', error);
      setProcessingStatus('Error processing documents. Please try again.');
    } finally {
      setIsSubmittingDocs(false);
    }
  }, [submissionId, isSubmittingDocs]);

  const checkDocsProcessed = useCallback(async () => {
    if (!submissionId) return false;

    const { data: docs } = await supabase
      .from('uploaded_documents')
      .select('id, processing_status')
      .eq('intake_submission_id', submissionId);

    const hasDocs = docs && docs.length > 0;
    const allProcessed = hasDocs && docs!.every(
      (d: { processing_status: string }) => isDocProcessed(d.processing_status)
    );

    setDocsProcessed(allProcessed ?? false);
    return allProcessed ?? false;
  }, [submissionId]);

  const handleContinueToLiquidity = useCallback(async () => {
    if (!submissionId) return;

    const allProcessed = await checkDocsProcessed();
    if (!allProcessed) {
      return;
    }

    const { data: bankAccounts } = await supabase
      .from('bank_statement_accounts')
      .select('*')
      .eq('intake_submission_id', submissionId);

    const validAccounts = (bankAccounts ?? []).filter(isValidBankAccount);
    if (validAccounts.length > 0) {
      setExtractedData(buildExtractedDataFromAccounts(validAccounts));
    }

    await supabase
      .from('intake_submissions')
      .update({ processing_stage: 'liquidity_check' })
      .eq('id', submissionId);
    updateStep('liquidity_check');
  }, [submissionId, updateStep, checkDocsProcessed]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    if (!user || !submissionId) {
      console.error('Cannot upload: missing user or submissionId');
      return;
    }

    await supabase
      .from('intake_submissions')
      .update({ status: 'pending', processing_stage: 'documents_uploaded' })
      .eq('id', submissionId);

    let anySuccess = false;
    for (const file of Array.from(selectedFiles)) {
      const fileId = crypto.randomUUID();
      setFiles(prev => [...prev, { id: fileId, name: file.name, status: 'uploading' }]);
      const filePath = `${user.id}/${submissionId}/${fileId}-${file.name}`;
      const { error } = await supabase.storage.from('borrower-documents').upload(filePath, file);
      if (error) {
        console.error('Upload error:', error);
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
        continue;
      }
      await supabase.from('uploaded_documents').insert({
        intake_submission_id: submissionId,
        borrower_id: borrowerId || null,
        file_path: filePath,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        document_type: 'bank_statement',
        processing_status: 'pending',
      });
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'complete' } : f));
      anySuccess = true;
    }

    e.target.value = '';

    if (anySuccess) {
      console.log('[handleFileUpload] upload complete — waiting for user to click Process Documents');
    }
  }, [submissionId, user, borrowerId]);

  const runPreApproval = useCallback(async () => {
    if (!submissionId) return;

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
        borrowerType,
        creditScore: creditScoreNum,
        estimatedDscr: estimatedDscr ? parseFloat(estimatedDscr) : undefined,
      });

      setProcessingStatus('Running pre-approval analysis with program matching...');
      const result = await runPlacerBot(submissionId, loanPackage);
      console.log('PLACERBOT RESULT:', result);

      if (!result || !result.pre_approval) {
        console.error('Invalid PlacerBot result:', result);
        setProcessingStatus('Pre-approval failed - no result returned');
        setTimeout(() => setStep('liquidity_check'), 2000);
        return;
      }

      const preApproval = result.pre_approval as PreApprovalResult;
      setPreApprovalResult(preApproval);

      const verifiedLiquidityForGuard = rawBankAccounts.length > 0
        ? rawBankAccounts.reduce((sum, acc) => {
            const cash = parseFloat(String(acc.available_cash)) || parseFloat(String(acc.closing_balance)) || 0;
            return sum + cash;
          }, 0)
        : (extractedData?.total_available_cash || 0);

      const frontendPassesLiquidity = verifiedLiquidityForGuard >= requiredLiquidity;

      console.log('ROUTING CHECK:', {
        frontendPassesLiquidity,
        backendPassesLiquidity: preApproval?.passes_liquidity_check,
        verifiedLiquidityForGuard,
        requiredLiquidity,
        sub_status: preApproval?.sub_status
      });

      if (frontendPassesLiquidity) {
        setStep('result');
        setLockedStep('result');
        if (submissionId) {
          sessionStorage.setItem(`preapproval_step_${submissionId}`, 'result');
        }
      } else {
        setStep('liquidity_check');
        if (submissionId) {
          sessionStorage.setItem(`preapproval_step_${submissionId}`, 'liquidity_check');
        }
      }
    } catch (err) {
      console.error('PreApproval ERROR:', err);
      setProcessingStatus('Error running pre-approval. Please try again.');
      setTimeout(() => {
        setStep('liquidity_check');
        if (submissionId) {
          sessionStorage.setItem(`preapproval_step_${submissionId}`, 'liquidity_check');
        }
      }, 2000);
    }
  }, [submissionId, loanAmountNum, purchasePriceNum, propertyAddress, propertyCity, propertyState, propertyZip, loanType, borrowerType, creditScoreNum, estimatedDscr, rawBankAccounts, extractedData, requiredLiquidity]);

  const handleExportPdf = useCallback(async () => {
    if (!preApprovalResult || !preApprovalResult.letter_number || preApprovalResult.recommended_amount === null) return;

    const borrowerName = borrowerType === 'entity' && entityName
      ? entityName
      : (userAccount?.first_name && userAccount?.last_name
          ? `${userAccount.first_name} ${userAccount.last_name}`
          : 'Borrower');

    const today = new Date();
    const expiration = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const branding = borrowerId
      ? await fetchOrgBrandingForBorrower(borrowerId)
      : { orgName: 'Key Real Estate Capital', orgLogoUrl: null };

    const pdfHtml = generatePreApprovalPdfHtml({
      ...branding,
      borrowerName,
      borrowerType,
      entityName: entityName || undefined,
      loanAmount: preApprovalResult.recommended_amount,
      qualificationMin: preApprovalResult.qualification_min ?? 0,
      qualificationMax: preApprovalResult.qualification_max ?? 0,
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
  }, [preApprovalResult, borrowerType, entityName, userAccount, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum, borrowerId]);

  const handlePreviewPdf = useCallback(async () => {
    if (!preApprovalResult || !preApprovalResult.letter_number || preApprovalResult.recommended_amount === null) return;

    const borrowerName = borrowerType === 'entity' && entityName
      ? entityName
      : (userAccount?.first_name && userAccount?.last_name
          ? `${userAccount.first_name} ${userAccount.last_name}`
          : 'Borrower');

    const today = new Date();
    const expiration = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const branding = borrowerId
      ? await fetchOrgBrandingForBorrower(borrowerId)
      : { orgName: 'Key Real Estate Capital', orgLogoUrl: null };

    const pdfHtml = generatePreApprovalPdfHtml({
      ...branding,
      borrowerName,
      borrowerType,
      entityName: entityName || undefined,
      loanAmount: preApprovalResult.recommended_amount,
      qualificationMin: preApprovalResult.qualification_min ?? 0,
      qualificationMax: preApprovalResult.qualification_max ?? 0,
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
  }, [preApprovalResult, borrowerType, entityName, userAccount, loanType, propertyAddress, propertyCity, propertyState, propertyZip, purchasePriceNum, borrowerId]);

  const saveApplicationAsPendingApproval = useCallback(async () => {
    if (!submissionId || !user || applicationSaved || !preApprovalResult) return;

    const loanAmountNum = parseFloat(desiredLoanAmount.replace(/[^0-9.]/g, '')) || 0;
    const purchasePriceNum = parseFloat(estimatedPurchasePrice.replace(/[^0-9.]/g, '')) || 0;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    try {
      const { data: existingLoanRequest } = await supabase
        .from('loan_requests')
        .select('id')
        .eq('intake_submission_id', submissionId)
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
          intake_submission_id: submissionId,
          requested_amount: loanAmountNum || null,
          loan_purpose: loanType || null,
        });
      }

      const { data: existingProperty } = await supabase
        .from('properties')
        .select('id')
        .eq('intake_submission_id', submissionId)
        .maybeSingle();

      if (existingProperty) {
        await supabase
          .from('properties')
          .update({
            address_street: propertyAddress || null,
            address_city: propertyCity || null,
            address_state: propertyState || null,
            address_zip: propertyZip || null,
            purchase_price: purchasePriceNum || null,
          })
          .eq('id', existingProperty.id);
      } else if (propertyAddress || propertyState) {
        await supabase.from('properties').insert({
          intake_submission_id: submissionId,
          address_street: propertyAddress || null,
          address_city: propertyCity || null,
          address_state: propertyState || null,
          address_zip: propertyZip || null,
          purchase_price: purchasePriceNum || null,
        });
      }

      const hasQualifyingLender = preApprovalResult.has_qualifying_lender === true &&
        preApprovalResult.sub_status === 'pre_approved' &&
        preApprovalResult.letter_number !== null;

      const processingStage = hasQualifyingLender
        ? 'pre_approval_complete'
        : preApprovalResult.sub_status === 'liquidity_review_required'
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

      setApplicationSaved(true);
    } catch (error) {
      console.error('Error saving application:', error);
    }
  }, [submissionId, user, userAccount, applicationSaved, preApprovalResult, desiredLoanAmount, estimatedPurchasePrice, propertyAddress, propertyCity, propertyState, propertyZip, loanType, borrowerType, extractedData]);

  useEffect(() => {
    if (step === 'result' && preApprovalResult && !applicationSaved) {
      saveApplicationAsPendingApproval();
    }
  }, [step, preApprovalResult, applicationSaved, saveApplicationAsPendingApproval]);

  useEffect(() => {
    if (step !== 'liquidity_check' || !submissionId) return;
    let cancelled = false;
    (async () => {
      const { data: accounts } = await supabase
        .from('bank_statement_accounts')
        .select('*')
        .eq('intake_submission_id', submissionId);
      if (cancelled) return;
      const valid = (accounts || []).filter(isValidBankAccount);
      console.log('[liquidity_check] fresh bank accounts from DB:', valid.length, valid.map((a: BankAccountRow) => ({ bank: a.bank_name, cash: a.available_cash, closing: a.closing_balance })));
      setRawBankAccounts(valid);
      if (valid.length > 0) {
        setExtractedData(buildExtractedDataFromAccounts(valid));
        setBankDataExists(true);
      }
    })();
    return () => { cancelled = true; };
  }, [step, submissionId]);

  if (isInitializing) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8 text-center py-16">
        <Loader2 className="w-16 h-16 text-teal-600 animate-spin mx-auto mb-6" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Application</h2>
        <p className="text-gray-600">Setting up your loan application...</p>
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8 text-center py-16">
        <Loader2 className="w-16 h-16 text-teal-600 animate-spin mx-auto mb-6" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Processing</h2>
        <p className="text-gray-600">{processingStatus}</p>
      </div>
    );
  }

  if (step === 'loan_info') {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-6">
          <h2 className="text-2xl font-bold text-white">New Loan Application</h2>
          <p className="text-teal-100 mt-1">Get pre-approved in minutes</p>
        </div>

        <div className="p-8 space-y-8">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-teal-600" />
              Loan Details
            </h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Desired Loan Amount <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="text"
                    value={desiredLoanAmount}
                    onChange={(e) => setDesiredLoanAmount(formatInputCurrency(e.target.value))}
                    placeholder="500,000"
                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Estimated Purchase Price <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="text"
                    value={estimatedPurchasePrice}
                    onChange={(e) => setEstimatedPurchasePrice(formatInputCurrency(e.target.value))}
                    placeholder="650,000"
                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mt-4">
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Loan Type <span className="text-red-500">*</span>
            </label>
            <div className="grid md:grid-cols-2 gap-3">
              {LOAN_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setLoanType(type.value)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    loanType === type.value
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className={`font-medium ${loanType === type.value ? 'text-teal-700' : 'text-gray-900'}`}>
                    {type.label}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{type.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Home className="w-5 h-5 text-teal-600" />
              Property Address
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Street Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="123 Main Street"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={propertyCity}
                    onChange={(e) => setPropertyCity(e.target.value)}
                    placeholder="Los Angeles"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={propertyState}
                    onChange={(e) => setPropertyState(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="">Select</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">ZIP Code</label>
                  <input
                    type="text"
                    value={propertyZip}
                    onChange={(e) => setPropertyZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="90001"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-teal-600" />
              Borrower Type
            </h3>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setBorrowerType('individual')}
                className={`flex-1 p-4 rounded-lg border-2 text-center transition-all ${
                  borrowerType === 'individual'
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <User className={`w-8 h-8 mx-auto mb-2 ${borrowerType === 'individual' ? 'text-teal-600' : 'text-gray-400'}`} />
                <p className={`font-medium ${borrowerType === 'individual' ? 'text-teal-700' : 'text-gray-900'}`}>
                  Individual
                </p>
                <p className="text-sm text-gray-500">Personal application</p>
              </button>
              <button
                type="button"
                onClick={() => setBorrowerType('entity')}
                className={`flex-1 p-4 rounded-lg border-2 text-center transition-all ${
                  borrowerType === 'entity'
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Building2 className={`w-8 h-8 mx-auto mb-2 ${borrowerType === 'entity' ? 'text-teal-600' : 'text-gray-400'}`} />
                <p className={`font-medium ${borrowerType === 'entity' ? 'text-teal-700' : 'text-gray-900'}`}>
                  Entity / LLC
                </p>
                <p className="text-sm text-gray-500">Business application</p>
              </button>
            </div>

            {borrowerType === 'entity' && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Entity Name</label>
                <input
                  type="text"
                  value={entityName}
                  onChange={(e) => setEntityName(e.target.value)}
                  placeholder="ABC Properties LLC"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-600" />
              Government-Issued ID
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload your driver's license (US residents) or passport (foreign nationals or as alternative).
            </p>

            <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isForeignNational}
                  onChange={(e) => {
                    setIsForeignNational(e.target.checked);
                    if (e.target.checked) {
                      setIdDocumentType('passport');
                    }
                  }}
                  className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm font-medium text-gray-700">I am a foreign national</span>
              </label>
              {isForeignNational && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
                  Foreign nationals must upload a valid passport.
                </p>
              )}
            </div>

            <div className="flex gap-4 mb-4">
              <button
                type="button"
                disabled={isForeignNational}
                onClick={() => {
                  setIdDocumentType('drivers_license');
                  setIdDocumentCountry('US');
                }}
                className={`flex-1 p-4 rounded-lg border-2 text-center transition-all ${
                  isForeignNational ? 'opacity-50 cursor-not-allowed' : ''
                } ${
                  idDocumentType === 'drivers_license'
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileCheck className={`w-7 h-7 mx-auto mb-2 ${idDocumentType === 'drivers_license' ? 'text-teal-600' : 'text-gray-400'}`} />
                <p className={`font-medium ${idDocumentType === 'drivers_license' ? 'text-teal-700' : 'text-gray-900'}`}>
                  Driver's License
                </p>
                <p className="text-sm text-gray-500">US state-issued ID</p>
              </button>
              <button
                type="button"
                onClick={() => setIdDocumentType('passport')}
                className={`flex-1 p-4 rounded-lg border-2 text-center transition-all ${
                  idDocumentType === 'passport'
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className={`w-7 h-7 mx-auto mb-2 ${idDocumentType === 'passport' ? 'text-teal-600' : 'text-gray-400'}`} />
                <p className={`font-medium ${idDocumentType === 'passport' ? 'text-teal-700' : 'text-gray-900'}`}>
                  Passport
                </p>
                <p className="text-sm text-gray-500">{isForeignNational ? 'Required' : 'Any country'}</p>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {idDocumentType === 'drivers_license' ? 'License Number' : 'Passport Number'}
                </label>
                <input
                  type="text"
                  value={idDocumentNumber}
                  onChange={(e) => setIdDocumentNumber(e.target.value.toUpperCase())}
                  placeholder={idDocumentType === 'drivers_license' ? 'D1234567' : 'AB1234567'}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
              {idDocumentType === 'drivers_license' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Issuing State</label>
                  <select
                    value={idDocumentState}
                    onChange={(e) => setIdDocumentState(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                  >
                    <option value="">Select State</option>
                    {US_STATES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Issuing Country</label>
                  <input
                    type="text"
                    value={idDocumentCountry}
                    onChange={(e) => setIdDocumentCountry(e.target.value.toUpperCase())}
                    placeholder="US"
                    maxLength={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Expiration Date</label>
              <input
                type="date"
                value={idDocumentExpiration}
                onChange={(e) => setIdDocumentExpiration(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Upload {idDocumentType === 'drivers_license' ? 'Driver\'s License' : 'Passport'} (Required)
              </label>
              <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                idDocumentUploaded
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-300 hover:border-teal-400'
              }`}>
                <input
                  type="file"
                  id="id-document-upload"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleIdDocumentUpload}
                  disabled={idDocumentUploading || !borrowerId}
                  className="hidden"
                />
                <label htmlFor="id-document-upload" className={`cursor-pointer ${idDocumentUploading || !borrowerId ? 'cursor-not-allowed' : ''}`}>
                  {idDocumentUploading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
                      <span className="text-sm text-gray-600">Uploading...</span>
                    </div>
                  ) : idDocumentUploaded ? (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="text-sm text-green-700 font-medium">{idDocumentFileName}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-8 h-8 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Click to upload {idDocumentType === 'drivers_license' ? 'driver\'s license' : 'passport'}
                      </span>
                      <span className="text-xs text-gray-400">PDF, JPG, or PNG (max 10MB)</span>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-200">
            <button
              onClick={() => saveStepProgress('upload', 'loan_info_complete', submissionId || undefined)}
              disabled={!isLoanInfoComplete || !submissionId}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue to Document Upload
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'upload') {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-6">
          <h2 className="text-2xl font-bold text-white">Upload Bank Statements</h2>
          <p className="text-teal-100 mt-1">Upload your last 2 months of bank statements to verify liquidity</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="font-medium text-gray-900 mb-3">Your Loan Request Summary</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Loan Amount</p>
                <p className="font-semibold text-gray-900">{formatCurrency(loanAmountNum)}</p>
              </div>
              <div>
                <p className="text-gray-500">Purchase Price</p>
                <p className="font-semibold text-gray-900">{formatCurrency(purchasePriceNum)}</p>
              </div>
              <div>
                <p className="text-gray-500">Loan Type</p>
                <p className="font-semibold text-gray-900 capitalize">{loanType.replace(/_/g, ' ')}</p>
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
                <p className="font-medium text-amber-900">Important: Last 2 Months Required</p>
                <p className="text-sm text-amber-700 mt-1">
                  Please upload your most recent 2 months of bank statements. These are required to verify your liquidity and qualify for pre-approval.
                </p>
              </div>
            </div>
          </div>

          <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            !submissionId || !borrowerId
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
              : 'border-gray-300 hover:border-teal-400 cursor-pointer'
          }`}>
            <input
              type="file"
              id="bank-statements"
              multiple
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={!submissionId || !borrowerId}
              className="hidden"
            />
            <label htmlFor="bank-statements" className={!submissionId || !borrowerId ? 'cursor-not-allowed' : 'cursor-pointer'}>
              {!submissionId || !borrowerId ? (
                <>
                  <Loader2 className="w-12 h-12 text-gray-300 mx-auto mb-4 animate-spin" />
                  <p className="text-lg font-medium text-gray-500 mb-1">Preparing upload...</p>
                  <p className="text-sm text-gray-400">Please wait a moment</p>
                </>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-900 mb-1">Drop files here or click to upload</p>
                  <p className="text-sm text-gray-500">PDF bank statements (last 2 months minimum)</p>
                </>
              )}
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-gray-900">Uploaded Files</h3>
              {files.map(file => (
                <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-700">{file.name}</span>
                  </div>
                  {file.status === 'uploading' && <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />}
                  {file.status === 'processing' && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />}
                  {file.status === 'complete' && <CheckCircle className="w-5 h-5 text-green-600" />}
                  {file.status === 'error' && <AlertTriangle className="w-5 h-5 text-red-600" />}
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

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              onClick={() => saveStepProgress('loan_info', 'documents_uploading', submissionId || undefined)}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
              disabled={isSubmittingDocs}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="flex items-center gap-3">
              {files.length > 0 && !docsProcessed && !isSubmittingDocs && (
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
                  onClick={handleContinueToLiquidity}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
              {files.length === 0 && !isSubmittingDocs && (
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
        </div>
      </div>
    );
  }

  if (step === 'liquidity_check') {
    const verifiedLiquidity = rawBankAccounts.length > 0
      ? rawBankAccounts.reduce((sum, acc) => {
          const cash = parseFloat(String(acc.available_cash)) || parseFloat(String(acc.closing_balance)) || 0;
          return sum + cash;
        }, 0)
      : (extractedData?.total_available_cash || 0);
    const passesLiquidityCheck = verifiedLiquidity >= requiredLiquidity;
    const shortfall = requiredLiquidity - verifiedLiquidity;

    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className={`px-8 py-6 ${passesLiquidityCheck ? 'bg-gradient-to-r from-green-600 to-green-700' : 'bg-gradient-to-r from-amber-500 to-amber-600'}`}>
          <div className="flex items-center gap-3">
            {passesLiquidityCheck ? (
              <CheckCircle className="w-8 h-8 text-white" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-white" />
            )}
            <div>
              <h2 className="text-2xl font-bold text-white">
                {passesLiquidityCheck ? 'Liquidity Requirement Met!' : 'Liquidity Requirement Not Met'}
              </h2>
              <p className="text-white/80 mt-1">
                {passesLiquidityCheck
                  ? 'You have sufficient liquid assets to proceed'
                  : 'Additional funds may be required to qualify'
                }
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
                  {passesLiquidityCheck ? 'PASS' : 'FAIL'}
                </p>
              </div>
            </div>

            {!passesLiquidityCheck && (
              <div className="mt-4 pt-4 border-t border-amber-200">
                <p className="text-amber-800">
                  You need an additional <span className="font-bold">{formatCurrency(shortfall)}</span> in verified liquid assets to meet the 4x requirement.
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Deposits</p>
                    <p className="text-xl font-bold text-green-600 tabular-nums">{formatCurrency(extractedData.avg_monthly_deposits)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Withdrawals</p>
                    <p className="text-xl font-bold text-red-600 tabular-nums">{formatCurrency(extractedData.avg_monthly_withdrawals)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Balance</p>
                    <p className="text-xl font-bold text-gray-900 tabular-nums">{formatCurrency(extractedData.avg_monthly_cash)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Cash Flow</p>
                    <p className={`text-xl font-bold tabular-nums ${extractedData.avg_monthly_net_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {extractedData.avg_monthly_net_flow >= 0 ? '+' : ''}{formatCurrency(extractedData.avg_monthly_net_flow)}
                    </p>
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
                          <p className="font-medium text-green-600 tabular-nums">+{formatCurrency(account.total_deposits)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-gray-500">Withdrawals</p>
                          <p className="font-medium text-red-600 tabular-nums">-{formatCurrency(account.total_withdrawals)}</p>
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
                <li>The PDF is scanned or image-based (OCR may have limited accuracy)</li>
                <li>The bank statement format is not recognized</li>
                <li>The document is not a bank statement</li>
              </ul>
            </div>
          )}

          {passesLiquidityCheck ? (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => updateStep('upload')}
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
                  onClick={() => updateStep('upload')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Upload More Documents
                </button>
                <button
                  onClick={() => updateStep('loan_info')}
                  className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  Adjust Loan Terms
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === 'result' && preApprovalResult) {

    const loanTypeLabel = LOAN_TYPES.find(l => l.value === loanType)?.label || loanType.replace(/_/g, ' ');
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });


    const eligiblePrograms = preApprovalResult.matched_programs.filter(p => p.fit_category !== 'no_fit');

    const isPreApproved = preApprovalResult.sub_status === 'pre_approved';

    const canShowLetter = isPreApproved &&
      preApprovalResult.letter_number !== null &&
      preApprovalResult.recommended_amount !== null &&
      preApprovalResult.recommended_amount > 0 &&
      preApprovalResult.qualification_min !== null &&
      preApprovalResult.qualification_min > 0 &&
      eligiblePrograms.length > 0;

    const getFitCategoryStyle = (category: string) => {
      switch (category) {
        case 'strong_fit': return 'bg-green-100 text-green-700';
        case 'good_fit': return 'bg-blue-100 text-blue-700';
        case 'conditional_fit': return 'bg-amber-100 text-amber-700';
        default: return 'bg-gray-100 text-gray-700';
      }
    };

    if (!canShowLetter) {
      return (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-white" />
                <div>
                  <h2 className="text-2xl font-bold text-white">Status: Pending Review</h2>
                  <p className="text-amber-100 mt-1">Application submitted on {today}</p>
                </div>
              </div>
            </div>

            <div className="p-8 space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                <p className="text-gray-800 leading-relaxed">
                  We were unable to match your application with a qualifying lender based on the current information provided.
                </p>
                <p className="text-gray-700 mt-4">
                  Your application will be reviewed further, and additional structuring options may be available.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Info className="w-5 h-5 text-gray-500" />
                  Common factors impacting eligibility may include:
                </h3>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-1">-</span>
                    <span>Loan amount outside program range</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-1">-</span>
                    <span>Insufficient liquidity for required reserves</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-1">-</span>
                    <span>DSCR below required threshold</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-1">-</span>
                    <span>Credit score requirements not met</span>
                  </li>
                </ul>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">Loan Request Details</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Loan Type</span>
                      <span className="font-medium text-gray-900">{loanTypeLabel}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Requested Amount</span>
                      <span className="font-medium text-gray-900">{formatCurrency(preApprovalResult.requested_loan_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Credit Score</span>
                      <span className="font-medium text-gray-900">{creditScoreNum}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Borrower Type</span>
                      <span className="font-medium text-gray-900 capitalize">{borrowerType}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">Property</h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-start gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">{propertyAddress || 'Address not provided'}</p>
                        <p className="text-sm text-gray-600">{propertyCity}, {propertyState} {propertyZip}</p>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-gray-200 mt-2">
                      <span className="text-gray-600">Purchase Price</span>
                      <span className="font-medium text-gray-900">{formatCurrency(purchasePriceNum)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Dashboard
                </button>
                <p className="text-sm text-gray-500">
                  Our team will contact you within 1-2 business days
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-8">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <FileCheck className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Pre-Approval Letter</h2>
                </div>
                <div className="flex items-center gap-4 text-sm text-teal-100">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-teal-300 rounded-full"></span>
                    {preApprovalResult.letter_number}
                  </span>
                  <span className="text-teal-300">|</span>
                  <span>Issued {today}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreviewPdf}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  View Letter
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
            <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-gray-900 font-semibold">Pre-Approved</p>
                  <p className="text-teal-600 text-sm">Matched with qualifying lender. Subject to final underwriting review.</p>
                </div>
              </div>
            </div>

            <div className="text-center border-b border-gray-200 pb-6">
              <p className="text-gray-600 mb-2">This letter confirms that</p>
              <p className="text-2xl font-bold text-gray-900 mb-2">
                {borrowerType === 'entity' && entityName ? entityName : (userAccount?.first_name && userAccount?.last_name ? `${userAccount.first_name} ${userAccount.last_name}` : 'Borrower')}
              </p>
              <p className="text-gray-600">is pre-approved for financing up to</p>
              <p className="text-4xl font-bold text-teal-600 my-4">
                {formatCurrency(preApprovalResult.recommended_amount ?? 0)}
              </p>
            </div>

            <div className="bg-gradient-to-r from-teal-50 to-blue-50 border border-teal-200 rounded-xl p-5 my-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-teal-600" />
                </div>
                <div>
                  <p className="font-medium text-teal-800 mb-1">PlacerBot Summary</p>
                  <p className="text-sm text-gray-700">
                    {(() => {
                      const eligible = preApprovalResult.matched_programs.filter(p => p.eligible || p.fit_category === 'strong_fit' || p.fit_category === 'good_fit');
                      const closest = preApprovalResult.matched_programs.filter(p => p.fit_category === 'closest_option');
                      const eligibleNames = eligible.slice(0, 2).map(p => p.lender_name);

                      if (eligible.length > 0) {
                        return `Borrower qualifies strongly for ${loanTypeLabel} financing, with ${eligible.length === 1 ? 'one fully eligible lender' : `${eligible.length} fully eligible lenders`} (${eligibleNames.join(', ')})${closest.length > 0 ? ` and ${closest.length} additional option${closest.length > 1 ? 's' : ''} available with minor structuring adjustments` : ''}.`;
                      } else if (closest.length > 0) {
                        return `Borrower is near qualification for ${loanTypeLabel} financing. ${closest.length} lender program${closest.length > 1 ? 's' : ''} available with minor structuring adjustments.`;
                      }
                      return `Application under review for ${loanTypeLabel} financing options.`;
                    })()}
                  </p>
                </div>
              </div>
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
                    <span className="font-medium text-gray-900">{formatCurrency(preApprovalResult.recommended_amount ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Credit Score</span>
                    <span className="font-medium text-gray-900">{creditScoreNum}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Borrower Type</span>
                    <span className="font-medium text-gray-900 capitalize">{borrowerType}</span>
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
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-600" />
                Financial Verification
              </h3>
              <div className={`rounded-lg border-2 p-4 ${preApprovalResult.passes_liquidity_check ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-gray-900">Liquidity Check</p>
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                    preApprovalResult.passes_liquidity_check
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {preApprovalResult.passes_liquidity_check ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {preApprovalResult.passes_liquidity_check ? 'Passed' : 'Insufficient'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Verified Cash</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(preApprovalResult.verified_liquidity)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Required (4x Payment)</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(preApprovalResult.required_liquidity)}</p>
                  </div>
                </div>
                {!preApprovalResult.passes_liquidity_check && (
                  <div className="bg-amber-100 rounded-lg p-3 mb-3 text-sm text-amber-800">
                    Shortfall: {formatCurrency(preApprovalResult.required_liquidity - preApprovalResult.verified_liquidity)}
                  </div>
                )}
              </div>
              {extractedData && extractedData.bank_accounts_found > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">{extractedData.bank_accounts_found} Bank Statement{extractedData.bank_accounts_found !== 1 ? 's' : ''} Analyzed · {extractedData.months_of_data} Month{extractedData.months_of_data !== 1 ? 's' : ''} of Data</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Deposits</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(extractedData.avg_monthly_deposits)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Withdrawals</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(extractedData.avg_monthly_withdrawals)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Monthly Balance</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(extractedData.avg_monthly_cash)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Cash Flow</p>
                      <p className={`text-lg font-bold ${extractedData.avg_monthly_net_flow >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {extractedData.avg_monthly_net_flow >= 0 ? '+' : ''}{formatCurrency(extractedData.avg_monthly_net_flow)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {preApprovalResult.matched_programs.filter(p => p.fit_category !== 'no_fit').length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-teal-600" />
                  Matched Lender Programs
                </h3>
                <div className="space-y-3">
                  {preApprovalResult.matched_programs
                    .filter(p => p.fit_category !== 'no_fit')
                    .slice(0, 5)
                    .map((program, idx) => (
                    <div key={idx} className="border border-green-200 bg-green-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-medium text-gray-900">{program.lender_name}</p>
                          <p className="text-sm text-gray-600">{program.program_name}</p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getFitCategoryStyle(program.fit_category)}`}>
                            {program.fit_category.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      {program.passing_criteria?.length > 0 && (
                        <div className="border-t border-gray-200 pt-3">
                          <p className="text-xs font-medium text-green-700 mb-1">Criteria met:</p>
                          {program.passing_criteria.map((criterion, cIdx) => (
                            <div key={`p-${cIdx}`} className="flex items-start gap-2 text-xs text-green-700">
                              <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <span>{criterion}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {program.indicative_rate > 0 && (
                        <p className="text-sm text-teal-700 font-medium mt-2 pt-2 border-t border-gray-200">
                          Indicative Rate: {(program.indicative_rate * 100).toFixed(2)}%
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border border-amber-200 bg-amber-50 rounded-xl p-6">
              <h3 className="font-semibold text-amber-900 mb-4">Pre-Approved Subject To:</h3>
              <ul className="space-y-2">
                <li className="flex items-start gap-2 text-amber-800 text-sm">
                  <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">1</span>
                  Final lender underwriting approval
                </li>
                <li className="flex items-start gap-2 text-amber-800 text-sm">
                  <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">2</span>
                  Property appraisal and eligibility
                </li>
                <li className="flex items-start gap-2 text-amber-800 text-sm">
                  <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium">3</span>
                  Loan structure within lender LTV limits
                </li>
              </ul>
            </div>

            <div className="bg-gray-100 rounded-lg p-4 text-sm text-gray-600">
              <p className="mb-2">
                <strong>Valid Until:</strong> {expirationDate}
              </p>
              <p>
                This pre-approval is based on information provided and is subject to verification. Final approval is contingent upon satisfactory completion of all conditions listed above, property appraisal, and underwriting review. This letter does not constitute a commitment to lend. Terms and conditions are subject to change.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => updateStep('liquidity_check')}
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

        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-amber-900">Pending Internal Review</h3>
              <p className="text-sm text-amber-700">
                Your application has been submitted and is awaiting approval from our team.
                You can view the status anytime in your Loan Applications.
              </p>
            </div>
          </div>
        </div>

        {onComplete && (
          <div className="flex justify-center">
            <button
              onClick={onComplete}
              className="px-8 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}
