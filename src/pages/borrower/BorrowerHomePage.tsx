import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { createLinkToken, notifyLinkSuccess, getReportStatus } from '../../services/plaidService';
import { logError } from '../../lib/errorLog';
import { generatePreApprovalPdf, fetchOrgBrandingForBorrower } from '../../lib/pdfGenerator';
import { Urla1003DetailsForm } from '../../components/borrower/Urla1003DetailsForm';
import {
  Building2, CheckCircle2, DollarSign, Plus, Download,
  Shield, Banknote, FileText, ArrowRight, Loader2, AlertCircle, ExternalLink, Gauge
} from 'lucide-react';

// ISC / MeridianLink SmartPay self-service link. A borrower who runs their own
// credit here triggers a SOFT pull (no impact to their score); the results flow
// to the broker on the back end.
const SELF_CREDIT_PULL_URL = 'https://iscsite.meridianlink.com/smartpay/SmartPay.aspx?uid=2a0fe0a6f97449a1a907a138008c1207';

interface BorrowerData {
  id: string;
  borrower_name: string;
  credit_score: number | null;
  lifecycle_stage: string | null;
  entity_type: string | null;
  llc_name: string | null;
}

interface FinancialProfile {
  liquidity_estimate: number | null;
  confidence_score: number | null;
  summary: Record<string, unknown> | null;
}

interface PreApprovalData {
  id: string;
  prequalified_amount: number;
  status: string;
  summary: string | null;
  loan_type: string | null;
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  dscr: 'DSCR Rental Loan',
  fix_flip: 'Fix & Flip Loan',
  bridge: 'Bridge Loan',
};

export function BorrowerHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [borrower, setBorrower] = useState<BorrowerData | null>(null);
  const [financialProfile, setFinancialProfile] = useState<FinancialProfile | null>(null);
  const [preApprovals, setPreApprovals] = useState<PreApprovalData[]>([]);
  const [showCompleteApp, setShowCompleteApp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [llcName, setLlcName] = useState('');
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [creditPullStarted, setCreditPullStarted] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const uploadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!user) return;

    const { data: borrowerData } = await supabase
      .from('borrowers')
      .select('id, borrower_name, credit_score, lifecycle_stage, entity_type, llc_name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!borrowerData) {
      setIsLoading(false);
      return;
    }

    setBorrower(borrowerData);
    if (borrowerData.llc_name) setLlcName(borrowerData.llc_name);

    const [profileResult, preApprovalResult] = await Promise.all([
      supabase
        .from('borrower_financial_profiles')
        .select('liquidity_estimate, confidence_score, summary')
        .eq('borrower_id', borrowerData.id)
        .maybeSingle(),
      supabase
        .from('pre_approvals')
        .select('id, prequalified_amount, status, summary, loan_type')
        .eq('borrower_id', borrowerData.id)
        .order('created_at', { ascending: false }),
    ]);

    setFinancialProfile(profileResult.data || null);
    setPreApprovals(preApprovalResult.data || []);
    setIsLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const liquidityVerified = financialProfile && financialProfile.liquidity_estimate && financialProfile.liquidity_estimate > 0;
  const confirmedLiquidity = financialProfile?.liquidity_estimate || 0;
  const dscrMax = confirmedLiquidity * 4;
  const fixFlipMax = confirmedLiquidity * 10;
  const bridgeMax = confirmedLiquidity * 5;
  const hasPreApproval = preApprovals.length > 0;

  const refreshLinkToken = useCallback(async () => {
    try {
      const token = await createLinkToken();
      setLinkToken(token);
    } catch (err) {
      logError('plaid.create_link_token', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize bank link');
    }
  }, []);

  // Fetch a Plaid link token once the borrower is loaded
  useEffect(() => {
    if (!borrower) return;
    refreshLinkToken();
  }, [borrower, refreshLinkToken]);

  const [reportPending, setReportPending] = useState(false);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: () => {
      setPlaidLoading(false);
      setReportPending(true);
      notifyLinkSuccess().catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to start report');
      });
      refreshLinkToken();
    },
    onExit: (plaidErr) => {
      setPlaidLoading(false);
      // Surface the real Plaid Link error (institution down, identity
      // mismatch, etc.) instead of failing silently, and always offer the
      // statement-upload fallback. A null error means the user just closed
      // the modal — no message needed.
      if (plaidErr) {
        logError('plaid.link_exit', plaidErr, { error_code: plaidErr.error_code, error_type: plaidErr.error_type });
        const detail = plaidErr.display_message || plaidErr.error_message || plaidErr.error_code || 'Connection failed';
        setError(`Bank connection didn't complete: ${detail}. You can try again, or upload bank statements below instead.`);
        // Plaid invalidates the token after some errors — get a fresh one.
        refreshLinkToken();
      }
    },
  });

  // Wait for Plaid Check report readiness while pending. PUSH-first: the
  // plaid-webhook flips borrowers.plaid_report_status server-side and we get
  // that row change instantly over Supabase Realtime. A slow 30s fallback poll
  // remains because get_report_status also performs the server-side recovery
  // fetch (missed webhooks, report-not-yet-created windows). This replaced a
  // 5s poll (~60 calls/borrower; thousands/hour at scale).
  useEffect(() => {
    if (!reportPending) return;
    let cancelled = false;
    const startedAt = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;

    const check = async () => {
      try {
        const { status, detail } = await getReportStatus();
        if (cancelled) return false;
        if (status === 'ready') {
          const { data: profile } = await supabase
            .from('borrower_financial_profiles')
            .select('liquidity_estimate')
            .eq('borrower_id', borrower!.id)
            .maybeSingle();
          if (cancelled) return true;
          if (profile?.liquidity_estimate) {
            await generatePreApprovals(profile.liquidity_estimate);
          }
          if (!cancelled) {
            setReportPending(false);
            await loadData();
          }
          return true;
        } else if (status === 'error') {
          if (!cancelled) {
            setReportPending(false);
            logError('plaid.report_error', detail || 'unknown', { borrowerId: borrower?.id });
            // Most terminal CRA failures are the connected bank's data, not
            // something reconnecting the same bank fixes — surface Plaid's
            // reason and point to the alternatives (different bank, or upload
            // statements, both available in this same step above).
            setError(
              `${detail || 'Your bank report could not be generated.'} You can try connecting a different bank, or upload your bank statements instead.`
            );
          }
          return true;
        }
      } catch {
        // Transient polling error — keep going
      }
      if (Date.now() - startedAt > TIMEOUT_MS) {
        if (!cancelled) {
          setReportPending(false);
          // Not a failure — connecting several banks just takes a while. We keep
          // finishing it in the background (a sweep runs every few minutes), so
          // tell the borrower it's still in progress rather than alarming them.
          setUploadSuccess('Your bank report is still generating in the background — this can take a few minutes when several accounts are connected. You can leave this page; check back shortly and your pre-approval will be ready.');
        }
        return true;
      }
      return false;
    };

    check();

    // Primary signal: realtime push on the borrower's own row (RLS-scoped).
    const channel = supabase
      .channel(`borrower-status-${borrower!.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'borrowers',
        filter: `id=eq.${borrower!.id}`,
      }, (payload) => {
        const status = (payload.new as { plaid_report_status?: string | null })?.plaid_report_status;
        if (status === 'ready' || status === 'error') check();
      })
      .subscribe();

    // Fallback: slow poll — also drives the server-side recovery fetch.
    const interval = setInterval(async () => {
      const done = await check();
      if (done) clearInterval(interval);
    }, 30_000);

    return () => { cancelled = true; clearInterval(interval); supabase.removeChannel(channel); };
  }, [reportPending, borrower, loadData]);

  // While the Plaid report is generating (it can take a minute), auto-open the
  // rest-of-1003 form so the borrower fills it out instead of staring at a
  // spinner.
  useEffect(() => {
    if (reportPending) setShowCompleteApp(true);
  }, [reportPending]);

  const handlePlaidConnect = () => {
    if (!plaidReady || !linkToken) {
      setError('Bank connection not ready yet — try again in a moment.');
      return;
    }
    setError(null);
    setPlaidLoading(true);
    openPlaid();
  };

  // Remember (client-side only) that the borrower launched the self-service
  // credit pull, so the card reflects it on return. No DB write — borrowers
  // can't write borrower_activity_log, and the soft-pull results reach the
  // broker through ISC on the back end regardless.
  useEffect(() => {
    if (borrower && localStorage.getItem(`credit_pull_started_${borrower.id}`) === '1') {
      setCreditPullStarted(true);
    }
  }, [borrower]);

  const handleSelfCreditPull = () => {
    if (borrower) localStorage.setItem(`credit_pull_started_${borrower.id}`, '1');
    setCreditPullStarted(true);
    window.open(SELF_CREDIT_PULL_URL, '_blank', 'noopener,noreferrer');
  };

  // PDF upload handler

  // Once statements are safely stored, automated extraction failing must never
  // surface as an error — the files are kept and a human reviews them instead.
  const fallBackToManualReview = async (borrowerId: string, fileNames: string[]) => {
    await supabase.from('borrowers')
      .update({ borrower_status: 'submitted' })
      .eq('id', borrowerId);
    setUploadSuccess(
      `We received ${fileNames.join(', ')}. We couldn't automatically read the statement details, ` +
      `so your broker will review them and follow up shortly with your pre-approval. No action needed.`
    );
    await loadData();
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !borrower || !user) return;
    // Guard against double-fire: state updates are async, so a rapid second
    // change event could start a parallel upload and create a duplicate
    // submission. A ref flips synchronously.
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    // Reset the input so selecting the same file again re-triggers onChange.
    const inputEl = e.target;
    setUploadLoading(true);
    setError(null);
    setUploadSuccess(null);

    try {
      const uploadedFileNames: string[] = [];

      // 1. Create an intake submission so the edge function can process it
      const { data: submission, error: subError } = await supabase
        .from('intake_submissions')
        .insert({
          user_id: user.id,
          borrower_id: borrower.id,
          status: 'submitted',
          processing_stage: 'documents_uploading',
        })
        .select('id')
        .single();
      if (subError || !submission) {
        console.error('Failed to create submission:', subError);
        throw subError || new Error('Failed to create submission');
      }

      const submissionId = submission.id;

      // 2. Upload files and create uploaded_documents linked to the submission
      for (const file of Array.from(files)) {
        const filePath = `borrowers/${user.id}/financial/${Date.now()}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from('borrower-documents')
          .upload(filePath, file);
        if (uploadError) throw uploadError;

        const { error: docError } = await supabase.from('uploaded_documents').insert({
          borrower_id: borrower.id,
          intake_submission_id: submissionId,
          document_type: 'bank_statement',
          file_name: file.name,
          file_path: filePath,
          mime_type: file.type,
          file_size: file.size,
          processing_status: 'pending',
        });
        if (docError) {
          console.error('Failed to insert uploaded_document:', docError);
          throw docError;
        }

        uploadedFileNames.push(file.name);
      }

      setUploadSuccess(`Uploaded ${uploadedFileNames.join(', ')}. Analyzing your bank statements...`);

      // The files are stored and recorded — from here on, any analysis failure
      // falls back to manual broker review instead of erroring the borrower.
      try {
        // 3. Call the process-documents edge function
        await supabase
          .from('intake_submissions')
          .update({ processing_stage: 'documents_processing' })
          .eq('id', submissionId);

        // Send the borrower's own session token — process-documents now
        // verifies the caller owns this submission (or is staff).
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ submission_id: submissionId }),
        });

        const responseBody = await response.text().catch(() => '');
        console.log('Edge function response:', response.status, responseBody);

        if (!response.ok) {
          throw new Error(`Processing failed (${response.status}): ${responseBody.slice(0, 200)}`);
        }

        let edgeResult: { processed?: number; failed?: number; errors?: string[] } = {};
        try { edgeResult = JSON.parse(responseBody); } catch { /* ignore parse error */ }
        console.log('Edge function result:', edgeResult);

        if (edgeResult.processed === 0 && edgeResult.failed && edgeResult.failed > 0) {
          throw new Error(`Document processing failed: ${edgeResult.errors?.join('; ') || 'Unknown error'}`);
        }

        // 4. Poll for bank_statement_accounts results
        let accounts: Record<string, unknown>[] = [];
        // Try immediately first, then poll
        for (let i = 0; i < 15; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          const { data: polled } = await supabase
            .from('bank_statement_accounts')
            .select('*')
            .eq('intake_submission_id', submissionId);
          if (polled && polled.length > 0) {
            accounts = polled;
            break;
          }
        }

        // 5. Compute liquidity from extracted accounts. Treat "nothing usable"
        // (no rows, unreadable extraction, or $0 liquidity) as manual review.
        const totalLiquidity = accounts.reduce((sum, a) => sum + (Number(a.closing_balance) || 0), 0);
        const avgConfidence = accounts.length > 0
          ? accounts.reduce((sum, a) => sum + (Number(a.extraction_confidence) || 0), 0) / accounts.length
          : 0;

        if (accounts.length === 0 || totalLiquidity <= 0 || avgConfidence < 0.2) {
          console.warn('Statement extraction unusable — falling back to manual review', { accounts: accounts.length, totalLiquidity, avgConfidence });
          await fallBackToManualReview(borrower.id, uploadedFileNames);
          return;
        }

        // Update borrower financial profile
        await supabase.from('borrower_financial_profiles').upsert({
          borrower_id: borrower.id,
          liquidity_estimate: totalLiquidity,
          ending_balance_avg: totalLiquidity / accounts.length,
          avg_monthly_deposits: accounts.reduce((sum, a) => sum + (Number(a.total_deposits) || 0), 0) / accounts.length,
          confidence_score: Math.round(avgConfidence * 100),
          summary: {
            source: 'ai_extraction',
            extractions: accounts.map(a => ({
              bank: a.bank_name,
              holder: a.account_holder_name,
              closing_balance: a.closing_balance,
              deposits: a.total_deposits,
              withdrawals: a.total_withdrawals,
            })),
            total_liquidity: totalLiquidity,
            verified_at: new Date().toISOString(),
          },
        }, { onConflict: 'borrower_id' });

        // Manual-upload borrowers do NOT get auto-generated pre-approvals.
        // The broker reviews the extracted statements and finalizes a
        // pre-approval manually. The dashboard surfaces these with a
        // "Pending Pre-approval" badge.
        await supabase.from('borrowers')
          .update({ borrower_status: 'submitted' })
          .eq('id', borrower.id);

        setUploadSuccess(
          `Got it! We extracted $${totalLiquidity.toLocaleString()} in liquidity across ${accounts.length} account(s). ` +
          `Your broker will review your statements and follow up shortly with your pre-approval.`
        );

        await loadData();
      } catch (analysisErr) {
        // Files are already stored — never show the borrower an analysis error.
        logError('statement.analysis', analysisErr, { borrowerId: borrower.id, files: uploadedFileNames });
        await fallBackToManualReview(borrower.id, uploadedFileNames);
      }
    } catch (err: unknown) {
      // Only reaches here if the upload itself (storage/DB) failed — the file
      // was NOT saved, so the borrower genuinely needs to retry.
      logError('statement.upload', err, { borrowerId: borrower?.id });
      const message = err instanceof Error ? err.message
        : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
        : 'Upload failed. Please try again or contact your broker.';
      setError(message);
    } finally {
      uploadingRef.current = false;
      inputEl.value = '';
      setUploadLoading(false);
    }
  };

  const getCustomAmount = (pa: PreApprovalData) => {
    const custom = customAmounts[pa.id];
    if (custom) {
      const parsed = parseInt(custom.replace(/\D/g, ''));
      if (parsed > 0 && parsed <= pa.prequalified_amount) return parsed;
    }
    return pa.prequalified_amount;
  };

  const formatCurrency = (value: string) => {
    const num = value.replace(/\D/g, '');
    return num ? parseInt(num).toLocaleString() : '';
  };

  const handleDownloadPdf = async (pa: PreApprovalData) => {
    if (!borrower) return;
    const pdfAmount = getCustomAmount(pa);
    try {
      // Fetch broker info
      const { data: borrowerFull } = await supabase
        .from('borrowers')
        .select('broker_id')
        .eq('id', borrower.id)
        .maybeSingle();

      let brokerName = 'Your Broker';
      let brokerEmail: string | null = null;
      let brokerPhone: string | null = null;

      if (borrowerFull?.broker_id) {
        const { data: broker } = await supabase
          .from('user_accounts')
          .select('first_name, last_name, email, phone')
          .eq('id', borrowerFull.broker_id)
          .maybeSingle();
        if (broker) {
          brokerName = [broker.first_name, broker.last_name].filter(Boolean).join(' ');
          brokerEmail = broker.email;
          brokerPhone = broker.phone;
        }
      }

      // Org branding comes from an edge function so RLS on organization_members
      // doesn't block the borrower from reading their broker's org logo.
      const { orgName, orgLogoUrl } = await fetchOrgBrandingForBorrower(borrower.id);

      const today = new Date();
      const expiry = new Date(today);
      expiry.setDate(expiry.getDate() + 90);

      await generatePreApprovalPdf({
        orgName: orgName || 'Key Real Estate Capital',
        orgLogoUrl,
        borrowerName: borrower.borrower_name,
        llcName: llcName || null,
        preApprovalAmount: pdfAmount,
        loanType: pa.loan_type || 'dscr',
        loanPurpose: 'purchase',
        occupancy: 'Investment',
        propertyType: 'SFR',
        verifiedLiquidity: confirmedLiquidity,
        creditScore: borrower.credit_score,
        expirationDate: expiry.toLocaleDateString(),
        brokerName,
        brokerEmail,
        brokerPhone,
        issueDate: today.toLocaleDateString(),
        conditions: [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF');
    }
  };

  const generatePreApprovals = async (liquidity: number) => {
    if (!borrower) return;

    const dscrAmount = liquidity * 4;
    const fixFlipAmount = liquidity * 10;
    const bridgeAmount = liquidity * 5;

    // Upsert on the (borrower_id, loan_type) unique key — this runs from the
    // client poll and can race the webhook/sweep writing the same rows.
    await supabase.from('pre_approvals').upsert([
      {
        borrower_id: borrower.id,
        loan_type: 'dscr',
        status: 'approved',
        sub_status: 'pre_approved',
        prequalified_amount: dscrAmount,
        qualification_max: dscrAmount,
        verified_liquidity: liquidity,
        passes_liquidity_check: true,
        summary: `DSCR Loan Pre-Approval: Up to $${dscrAmount.toLocaleString()} based on $${liquidity.toLocaleString()} verified liquidity (4x multiplier)`,
        machine_decision: 'approved',
        machine_confidence: 95,
      },
      {
        borrower_id: borrower.id,
        loan_type: 'fix_flip',
        status: 'approved',
        sub_status: 'pre_approved',
        prequalified_amount: fixFlipAmount,
        qualification_max: fixFlipAmount,
        verified_liquidity: liquidity,
        passes_liquidity_check: true,
        summary: `Fix & Flip Pre-Approval: Up to $${fixFlipAmount.toLocaleString()} based on $${liquidity.toLocaleString()} verified liquidity (10x multiplier)`,
        machine_decision: 'approved',
        machine_confidence: 95,
      },
      {
        borrower_id: borrower.id,
        loan_type: 'bridge',
        status: 'approved',
        sub_status: 'pre_approved',
        prequalified_amount: bridgeAmount,
        qualification_max: bridgeAmount,
        verified_liquidity: liquidity,
        passes_liquidity_check: true,
        summary: `Bridge Loan Pre-Approval: Up to $${bridgeAmount.toLocaleString()} based on $${liquidity.toLocaleString()} verified liquidity (5x multiplier)`,
        machine_decision: 'approved',
        machine_confidence: 95,
      },
    ], { onConflict: 'borrower_id,loan_type' });

    await supabase.from('borrowers')
      .update({ lifecycle_stage: 'pre_approved', borrower_status: 'prequalified' })
      .eq('id', borrower.id);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (!borrower) {
    // First time here — send them to the profile form to complete intake
    // before they can see the dashboard. The profile page enforces every
    // field needed for the 1003 / credit pull / pre-approval downstream.
    return <Navigate to="/application/profile" replace />;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
          Welcome, {borrower.borrower_name.split(' ')[0]}
        </h1>
        <p className="text-gray-500 mt-1">Complete the steps below to get pre-approved for your loan.</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {reportPending && (
        <div className="mb-6 px-4 py-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center gap-3">
          <Loader2 className="w-4 h-4 flex-shrink-0 text-teal-600 animate-spin" />
          <div className="flex-1">
            <p className="text-sm font-medium text-teal-900">Bank connected — generating your report</p>
            <p className="text-xs text-teal-700">This usually takes under a minute. You can stay on this page.</p>
          </div>
        </div>
      )}

      {/* Step 1: Verify Liquidity */}
      <div className={`mb-6 border rounded-xl overflow-hidden ${liquidityVerified ? 'border-teal-200 bg-teal-50/30' : 'border-gray-200 bg-white'}`}>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {liquidityVerified ? (
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-teal-600" />
                </div>
              ) : (
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <Banknote className="w-5 h-5 text-gray-500" />
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Step 1: Verify Liquidity</h2>
                <p className="text-sm text-gray-500">
                  {liquidityVerified
                    ? `Verified: $${confirmedLiquidity.toLocaleString()}`
                    : 'Connect your bank account or upload bank statements'}
                </p>
              </div>
            </div>
            {liquidityVerified && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlaidConnect}
                  disabled={plaidLoading || !plaidReady || reportPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-200 rounded-full hover:bg-teal-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {plaidLoading || reportPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  {reportPending ? 'Updating…' : 'Add More Liquidity'}
                </button>
                <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Verified</span>
              </div>
            )}
          </div>

          {!liquidityVerified && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Plaid Connect */}
              <button
                onClick={handlePlaidConnect}
                disabled={plaidLoading || !plaidReady || reportPending}
                className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-teal-300 rounded-xl hover:border-teal-500 hover:bg-teal-50 transition-all cursor-pointer disabled:opacity-50"
              >
                {plaidLoading || reportPending ? (
                  <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
                ) : (
                  <Shield className="w-8 h-8 text-teal-600" />
                )}
                <div className="text-center">
                  <p className="font-medium text-gray-900">
                    {reportPending ? 'Generating Report…' : 'Connect Bank Account'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {reportPending
                      ? 'This usually takes under a minute'
                      : 'Instant verification via Plaid'}
                  </p>
                </div>
                {!reportPending && (
                  <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Recommended</span>
                )}
              </button>

              {/* Statement Upload — accept ANY file type (PDFs, photos/screenshots
                  of statements, etc.); never restrict at the picker. */}
              <label className={`flex flex-col items-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer ${uploadLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                <input
                  type="file"
                  multiple
                  onChange={handlePdfUpload}
                  className="hidden"
                />
                {uploadLoading ? (
                  <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
                ) : (
                  <FileText className="w-8 h-8 text-gray-500" />
                )}
                <div className="text-center">
                  <p className="font-medium text-gray-900">Upload Bank Statements</p>
                  <p className="text-xs text-gray-500 mt-1">PDFs or photos, last 2-3 months</p>
                </div>
                <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">Manual Review</span>
              </label>
            </div>
          )}

          {uploadSuccess && (
            <div className="mt-4 px-4 py-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {uploadSuccess}
            </div>
          )}

          {liquidityVerified && financialProfile?.summary && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-teal-100 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">Verified Liquidity</p>
                <p className="text-xl font-semibold text-gray-900">${confirmedLiquidity.toLocaleString()}</p>
              </div>
              <div className="bg-white border border-teal-100 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">DSCR Max (4x)</p>
                <p className="text-xl font-semibold text-teal-700">${dscrMax.toLocaleString()}</p>
              </div>
              <div className="bg-white border border-teal-100 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">Fix & Flip Max (10x)</p>
                <p className="text-xl font-semibold text-teal-700">${fixFlipMax.toLocaleString()}</p>
              </div>
              <div className="bg-white border border-teal-100 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">Bridge Max (5x)</p>
                <p className="text-xl font-semibold text-teal-700">${bridgeMax.toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Optional: Run Your Own Credit (soft pull) */}
      <div className={`mb-6 border rounded-xl overflow-hidden ${creditPullStarted ? 'border-teal-200 bg-teal-50/30' : 'border-gray-200 bg-white'}`}>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${creditPullStarted ? 'bg-teal-100' : 'bg-gray-100'}`}>
                {creditPullStarted
                  ? <CheckCircle2 className="w-5 h-5 text-teal-600" />
                  : <Gauge className="w-5 h-5 text-gray-500" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Run Your Credit <span className="text-sm font-normal text-gray-400">· Optional</span></h2>
                <p className="text-sm text-gray-500">
                  {creditPullStarted
                    ? 'Credit pull started — your lender will see the results automatically.'
                    : 'Pull your own credit in a couple of minutes to speed up your approval.'}
                </p>
              </div>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
              <Shield className="w-3 h-3" /> Soft pull — won't affect your score
            </span>
          </div>

          <div className="mt-4 px-4 py-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-800 flex items-start gap-2 sm:hidden">
            <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
            This is a <strong>soft pull</strong> — it will <strong>not</strong> affect your credit score.
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={handleSelfCreditPull}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {creditPullStarted ? 'Open Credit Form Again' : 'Run My Credit'}
            </button>
            <div className="text-xs text-gray-500">
              <p>Opens our secure credit partner (ISC / MeridianLink) in a new tab. Your results are sent straight to your lender.</p>
              <p className="mt-1 font-medium text-gray-600">There is a $65 charge to run your credit.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Pre-Approval */}
      <div className={`mb-6 border rounded-xl overflow-hidden ${hasPreApproval ? 'border-teal-200 bg-teal-50/30' : 'border-gray-200 bg-white'}`}>
        <div className="px-6 py-5">
          <div className="flex items-center gap-3">
            {hasPreApproval ? (
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-teal-600" />
              </div>
            ) : (
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-gray-400" />
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Step 2: Pre-Approval</h2>
              <p className="text-sm text-gray-500">
                {hasPreApproval
                  ? 'You are pre-approved! Choose a loan type below.'
                  : 'Complete liquidity verification to receive your pre-approval'}
              </p>
            </div>
          </div>

          {hasPreApproval && (
            <div className="mt-4 space-y-3">
              {/* Name for Pre-Approval Letter */}
              <div className="bg-white border border-teal-100 rounded-xl px-5 py-4">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Issue pre-approval letter in the name of:
                </label>
                <div className="flex gap-3 mb-3">
                  <button
                    type="button"
                    onClick={() => { setLlcName(''); if (borrower) supabase.from('borrowers').update({ llc_name: null }).eq('id', borrower.id); }}
                    className={`flex-1 px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${
                      !llcName ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium">{borrower.borrower_name}</p>
                    <p className="text-xs mt-0.5 opacity-70">Personal Name</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (!llcName) setLlcName(borrower.borrower_name + ' LLC'); }}
                    className={`flex-1 px-4 py-3 border-2 rounded-lg text-sm font-medium transition-all ${
                      llcName ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium">{llcName || 'Entity Name'}</p>
                    <p className="text-xs mt-0.5 opacity-70">LLC / Corporation</p>
                  </button>
                </div>
                {llcName && (
                  <input
                    type="text"
                    value={llcName}
                    onChange={e => setLlcName(e.target.value)}
                    onBlur={() => {
                      if (borrower) {
                        supabase.from('borrowers').update({ llc_name: llcName || null }).eq('id', borrower.id);
                      }
                    }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                    placeholder="Enter entity name"
                  />
                )}
              </div>

              {preApprovals.map((pa) => {
                const customVal = customAmounts[pa.id] || '';
                const effectiveAmount = getCustomAmount(pa);
                const isCustom = customVal && effectiveAmount !== pa.prequalified_amount;

                return (
                  <div key={pa.id} className="bg-white border border-teal-100 rounded-xl px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{LOAN_TYPE_LABELS[pa.loan_type || ''] || pa.loan_type || 'Loan'}</p>
                        <p className="text-sm text-gray-500 mt-0.5">Pre-approved up to <span className="font-medium text-teal-700">${pa.prequalified_amount?.toLocaleString()}</span></p>
                      </div>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">Approved</span>
                    </div>
                    <div className="mt-3 flex items-end gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Amount for letter</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                          <input
                            type="text"
                            value={customVal || pa.prequalified_amount.toLocaleString()}
                            onChange={e => {
                              const formatted = formatCurrency(e.target.value);
                              const parsed = parseInt(formatted.replace(/\D/g, '')) || 0;
                              if (parsed <= pa.prequalified_amount) {
                                setCustomAmounts(prev => ({ ...prev, [pa.id]: formatted }));
                              }
                            }}
                            className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                          />
                        </div>
                        {isCustom && (
                          <p className="text-xs text-gray-400 mt-1">Max: ${pa.prequalified_amount.toLocaleString()}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDownloadPdf(pa)}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Download PDF
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Step 3: New Loan */}
      <div className={`border rounded-xl overflow-hidden ${hasPreApproval ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasPreApproval ? 'bg-teal-100' : 'bg-gray-100'}`}>
                <Building2 className={`w-5 h-5 ${hasPreApproval ? 'text-teal-600' : 'text-gray-400'}`} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Step 3: Submit a Loan</h2>
                <p className="text-sm text-gray-500">
                  {hasPreApproval ? 'Ready to find your property' : 'Get pre-approved first to submit a loan'}
                </p>
              </div>
            </div>
            {hasPreApproval && (
              <button
                onClick={() => navigate('/application/new-loan')}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors group"
              >
                <Plus className="w-4 h-4" />
                New Loan
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Complete Application (rest of the Form 1003). Optional — surfaced as soon
          as assets are initiated (Plaid connecting / statements uploaded), so the
          borrower fills it out while the pre-approval is being generated. Never
          required to create an account or get pre-approved. */}
      {(reportPending || liquidityVerified || hasPreApproval) && (
        <div className={`mt-6 border rounded-xl bg-white overflow-hidden ${reportPending ? 'border-teal-300 ring-1 ring-teal-100' : 'border-gray-200'}`}>
          <div className="px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Complete Your Application</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {reportPending
                  ? 'Your bank connection is processing — this can take a minute. Use the time to finish the rest of your application (Form 1003) below so your file is ready the moment you’re pre-approved.'
                  : hasPreApproval
                    ? 'You’re pre-approved! Finish the rest of your loan application (Form 1003) — declarations, employment & income, assets, real estate, and demographic information.'
                    : 'Get a head start — finish the rest of your loan application (Form 1003) while we verify your assets.'}
              </p>
            </div>
            {!showCompleteApp && (
              <button
                onClick={() => setShowCompleteApp(true)}
                className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors group"
              >
                Complete Application
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}
          </div>
          {showCompleteApp && (
            <div className="px-6 py-5 border-t border-gray-100">
              <Urla1003DetailsForm borrowerId={borrower.id} onSaved={() => loadData()} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
