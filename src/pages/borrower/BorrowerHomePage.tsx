import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { createLinkToken, exchangePublicToken } from '../../services/plaidService';
import { generatePreApprovalPdf } from '../../lib/pdfGenerator';
import {
  Building2, CheckCircle2, DollarSign, Plus, Download,
  Shield, Banknote, FileText, ArrowRight, Loader2, AlertCircle
} from 'lucide-react';

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
  const [isLoading, setIsLoading] = useState(true);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [llcName, setLlcName] = useState('');

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

  // Plaid Link handler
  const handlePlaidConnect = async () => {
    setPlaidLoading(true);
    setError(null);
    try {
      const linkToken = await createLinkToken();
      // @ts-expect-error Plaid global
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken: string) => {
          try {
            const result = await exchangePublicToken(publicToken, borrower!.id);
            setFinancialProfile({
              liquidity_estimate: result.total_liquidity,
              confidence_score: 95,
              summary: { source: 'plaid', accounts: result.accounts },
            });
            await generatePreApprovals(result.total_liquidity);
            await loadData();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to verify accounts');
          }
          setPlaidLoading(false);
        },
        onExit: () => { setPlaidLoading(false); },
      });
      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to bank');
      setPlaidLoading(false);
    }
  };

  // PDF upload handler
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !borrower || !user) return;
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

      // 3. Call the process-documents edge function
      await supabase
        .from('intake_submissions')
        .update({ processing_stage: 'documents_processing' })
        .eq('id', submissionId);

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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

      if (accounts.length === 0) {
        // Check document processing status for a better error message
        const { data: docs } = await supabase
          .from('uploaded_documents')
          .select('processing_status, error_message')
          .eq('intake_submission_id', submissionId);
        const failedDocs = docs?.filter(d => d.processing_status === 'failed');
        const errorDetail = failedDocs?.map(d => d.error_message).filter(Boolean).join('; ');
        throw new Error(errorDetail || 'Could not extract data from your bank statements. Please ensure you upload clear PDF or image files.');
      }

      // 5. Compute liquidity from extracted accounts
      const totalLiquidity = accounts.reduce((sum, a) => sum + (Number(a.closing_balance) || 0), 0);
      const avgConfidence = accounts.reduce((sum, a) => sum + (Number(a.confidence) || 0), 0) / accounts.length;

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

      // Generate pre-approvals
      const dscrAmount = totalLiquidity * 4;
      const fixFlipAmount = totalLiquidity * 10;
      const bridgeAmount = totalLiquidity * 5;

      await supabase.from('pre_approvals').delete().eq('borrower_id', borrower.id);
      await supabase.from('pre_approvals').insert([
        {
          borrower_id: borrower.id,
          loan_type: 'dscr',
          status: 'approved',
          sub_status: 'pre_approved',
          prequalified_amount: dscrAmount,
          qualification_max: dscrAmount,
          verified_liquidity: totalLiquidity,
          passes_liquidity_check: true,
          summary: `DSCR Loan Pre-Approval: Up to $${dscrAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity`,
          machine_decision: 'approved',
          machine_confidence: Math.round(avgConfidence * 100),
        },
        {
          borrower_id: borrower.id,
          loan_type: 'fix_flip',
          status: 'approved',
          sub_status: 'pre_approved',
          prequalified_amount: fixFlipAmount,
          qualification_max: fixFlipAmount,
          verified_liquidity: totalLiquidity,
          passes_liquidity_check: true,
          summary: `Fix & Flip Pre-Approval: Up to $${fixFlipAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity`,
          machine_decision: 'approved',
          machine_confidence: Math.round(avgConfidence * 100),
        },
        {
          borrower_id: borrower.id,
          loan_type: 'bridge',
          status: 'approved',
          sub_status: 'pre_approved',
          prequalified_amount: bridgeAmount,
          qualification_max: bridgeAmount,
          verified_liquidity: totalLiquidity,
          passes_liquidity_check: true,
          summary: `Bridge Loan Pre-Approval: Up to $${bridgeAmount.toLocaleString()} based on $${totalLiquidity.toLocaleString()} verified liquidity`,
          machine_decision: 'approved',
          machine_confidence: Math.round(avgConfidence * 100),
        },
      ]);

      await supabase.from('borrowers')
        .update({ lifecycle_stage: 'pre_approved', borrower_status: 'prequalified' })
        .eq('id', borrower.id);

      setUploadSuccess(
        `Verified! Found $${totalLiquidity.toLocaleString()} in liquidity across ${accounts.length} account(s). ` +
        `Pre-approvals generated: DSCR up to $${dscrAmount.toLocaleString()}, ` +
        `Fix & Flip / Bridge up to $${fixFlipAmount.toLocaleString()}.`
      );

      await loadData();
    } catch (err: unknown) {
      console.error('Bank statement upload error:', err);
      const message = err instanceof Error ? err.message
        : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
        : 'Upload or analysis failed. Please try again or contact your broker.';
      setError(message);
    } finally {
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
      let orgName = '';
      let orgLogoUrl: string | null = null;

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

        // Try to get org branding
        const { data: orgMember } = await supabase
          .from('organization_members')
          .select('organizations(name, logo_url)')
          .eq('user_id', borrowerFull.broker_id)
          .maybeSingle();
        if (orgMember?.organizations) {
          const org = orgMember.organizations as unknown as { name: string; logo_url: string | null };
          orgName = org.name || '';
          orgLogoUrl = org.logo_url || null;
        }
      }

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

    await supabase.from('pre_approvals').insert([
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
    ]);

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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Profile Found</h2>
          <p className="text-gray-500">Please complete your application signup first.</p>
        </div>
      </div>
    );
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
              <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Verified</span>
            )}
          </div>

          {!liquidityVerified && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Plaid Connect */}
              <button
                onClick={handlePlaidConnect}
                disabled={plaidLoading}
                className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-teal-300 rounded-xl hover:border-teal-500 hover:bg-teal-50 transition-all cursor-pointer disabled:opacity-50"
              >
                {plaidLoading ? (
                  <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
                ) : (
                  <Shield className="w-8 h-8 text-teal-600" />
                )}
                <div className="text-center">
                  <p className="font-medium text-gray-900">Connect Bank Account</p>
                  <p className="text-xs text-gray-500 mt-1">Instant verification via Plaid</p>
                </div>
                <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Recommended</span>
              </button>

              {/* PDF Upload */}
              <label className={`flex flex-col items-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer ${uploadLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                <input
                  type="file"
                  accept=".pdf"
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
                  <p className="text-xs text-gray-500 mt-1">PDF files, last 2-3 months</p>
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
    </div>
  );
}
