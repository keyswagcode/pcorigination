import { useState, useEffect } from 'react';
import { User, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle as CheckCircle2, DollarSign, BarChart3, Shield, Loader as Loader2, FileText, Play, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ConfidenceBar } from './ConfidenceBar';
import { PlacerBotPanel } from '../placerbot';

interface BorrowerProfileViewProps {
  submissionId: string;
}

interface ProfileData {
  id: string;
  global_confidence_score: number;
  borrower_profile: Record<string, { extracted_value: unknown; confidence_score: number }>;
  income_analysis: {
    average_monthly_income: number;
    income_volatility_coefficient: number;
    income_trend_direction: string;
    recurring_income_detected: boolean;
    recurring_income_total: number;
    deposit_concentration_ratio: number;
    largest_single_deposit: number;
    overall_confidence: number;
  };
  bank_statement_analysis: {
    average_daily_balance: number;
    nsf_or_overdraft_count: number;
    number_of_negative_balance_days: number;
    overall_confidence: number;
  };
  computed_ratios: {
    estimated_dscr: number | null;
    dscr_confidence: number;
    liquidity_ratio: number | null;
    liquidity_confidence: number;
    income_volatility_ratio: number | null;
  };
  flags: {
    code: string;
    message: string;
    category: string;
    severity: string;
    threshold_value: number | null;
    actual_value: number | null;
  }[];
  confidence_breakdown: {
    income_confidence: number;
    risk_confidence: number;
    ratio_confidence: number;
    validation_pass_rate: number;
  };
}

interface SubmissionData {
  id: string;
  status: string;
  processing_stage: string | null;
  borrowers: {
    borrower_name: string;
    entity_type: string;
    state_of_residence: string | null;
    industry: string | null;
    years_self_employed: number | null;
  } | null;
}

export function BorrowerProfileView({ submissionId }: BorrowerProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    income: true,
    risk: true,
    ratios: true,
    flags: true,
    placerbot: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const fetchData = async () => {
    setLoading(true);

    const { data: submissionData } = await supabase
      .from('intake_submissions')
      .select(`
        id,
        status,
        processing_stage,
        borrowers (
          borrower_name,
          entity_type,
          state_of_residence,
          industry,
          years_self_employed
        )
      `)
      .eq('id', submissionId)
      .single();

    if (submissionData) {
      const mapped = {
        ...submissionData,
        borrowers: Array.isArray(submissionData.borrowers)
          ? submissionData.borrowers[0]
          : submissionData.borrowers,
      };
      setSubmission(mapped as SubmissionData);
    }

    const { data: profileData } = await supabase
      .from('borrower_profiles_final')
      .select('*')
      .eq('intake_submission_id', submissionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileData) {
      setProfile(profileData as ProfileData);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [submissionId]);

  const triggerProcessing = async () => {
    setProcessing(true);
    try {
      const { data: existingAccounts } = await supabase
        .from('bank_statement_accounts')
        .select('id')
        .eq('intake_submission_id', submissionId);

      if (existingAccounts && existingAccounts.length > 0) {
        console.log('[BorrowerProfileView] Bank data already exists — skipping processing');
        await fetchData();
        setProcessing(false);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-documents`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ submission_id: submissionId }),
      });

      const validateUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-extraction`;
      await fetch(validateUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ submission_id: submissionId }),
      });

      const calculateUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calculate-ratios`;
      await fetch(calculateUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ submission_id: submissionId }),
      });

      await fetchData();
    } catch (error) {
      console.error('Processing error:', error);
    }
    setProcessing(false);
  };

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'increasing':
        return <TrendingUp className="w-4 h-4 text-success-500" />;
      case 'declining':
        return <TrendingDown className="w-4 h-4 text-error-500" />;
      default:
        return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-error-500 bg-error-900/20';
      case 'caution':
        return 'border-warning-500 bg-warning-900/20';
      case 'warning':
        return 'border-gold-500 bg-gold-900/20';
      default:
        return 'border-navy-600 bg-navy-900/20';
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatRatio = (value: number | null) => {
    if (value === null) return '—';
    return value.toFixed(2);
  };

  const formatPercentage = (value: number | null) => {
    if (value === null) return '—';
    return `${(value * 100).toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle className="w-12 h-12 text-warning-500 mx-auto mb-4" />
        <p className="text-gray-400">Submission not found</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-navy-800 flex items-center justify-center">
              <User className="w-6 h-6 text-gold-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-100">
                {submission.borrowers?.borrower_name}
              </h2>
              <p className="text-sm text-gray-400">
                {submission.borrowers?.entity_type} | {submission.borrowers?.state_of_residence}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-8 text-center">
          <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-4">
            {submission.status === 'pending_review' || submission.status === 'processing'
              ? 'Documents are ready for processing'
              : 'Profile has not been generated yet'}
          </p>
          <button
            onClick={triggerProcessing}
            disabled={processing}
            className="btn-primary"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start Processing Pipeline
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-navy-800 flex items-center justify-center">
              <User className="w-6 h-6 text-gold-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-100">
                {submission.borrowers?.borrower_name}
              </h2>
              <p className="text-sm text-gray-400">
                {submission.borrowers?.entity_type} | {submission.borrowers?.state_of_residence}
                {submission.borrowers?.industry && ` | ${submission.borrowers.industry}`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500 mb-1">Global Confidence</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-gold-500">
                {Math.round(profile.global_confidence_score * 100)}%
              </span>
              {profile.global_confidence_score >= 0.85 ? (
                <CheckCircle2 className="w-5 h-5 text-success-500" />
              ) : profile.global_confidence_score >= 0.65 ? (
                <Shield className="w-5 h-5 text-gold-500" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-warning-500" />
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-4">
          <div>
            <ConfidenceBar
              value={profile.confidence_breakdown?.income_confidence || 0}
              label="Income"
              size="sm"
            />
          </div>
          <div>
            <ConfidenceBar
              value={profile.confidence_breakdown?.risk_confidence || 0}
              label="Risk Analysis"
              size="sm"
            />
          </div>
          <div>
            <ConfidenceBar
              value={profile.confidence_breakdown?.ratio_confidence || 0}
              label="Ratios"
              size="sm"
            />
          </div>
          <div>
            <ConfidenceBar
              value={profile.confidence_breakdown?.validation_pass_rate || 0}
              label="Validation"
              size="sm"
            />
          </div>
        </div>
      </div>

      {profile.flags && profile.flags.length > 0 && (
        <div className="card">
          <button
            onClick={() => toggleSection('flags')}
            className="w-full card-header flex items-center justify-between hover:bg-navy-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-warning-500" />
              <h3 className="font-semibold text-gray-200">
                Underwriting Flags ({profile.flags.length})
              </h3>
            </div>
            {expandedSections.flags ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {expandedSections.flags && (
            <div className="card-body space-y-3">
              {profile.flags.map((flag, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${getSeverityColor(flag.severity)}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-200">{flag.message}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        Category: {flag.category} | Code: {flag.code}
                      </p>
                    </div>
                    <span
                      className={`badge ${
                        flag.severity === 'critical'
                          ? 'badge-error'
                          : flag.severity === 'caution'
                          ? 'badge-warning'
                          : 'badge-info'
                      }`}
                    >
                      {flag.severity}
                    </span>
                  </div>
                  {flag.threshold_value !== null && flag.actual_value !== null && (
                    <div className="mt-2 text-sm text-gray-500">
                      Threshold: {formatPercentage(flag.threshold_value)} | Actual:{' '}
                      {formatPercentage(flag.actual_value)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <button
          onClick={() => toggleSection('income')}
          className="w-full card-header flex items-center justify-between hover:bg-navy-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-gold-500" />
            <h3 className="font-semibold text-gray-200">Income Analysis</h3>
          </div>
          {expandedSections.income ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {expandedSections.income && (
          <div className="card-body">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500">Average Monthly Income</p>
                <p className="text-2xl font-semibold text-gray-100 mt-1">
                  {formatCurrency(profile.income_analysis?.average_monthly_income)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Income Trend</p>
                <div className="flex items-center gap-2 mt-1">
                  {getTrendIcon(profile.income_analysis?.income_trend_direction)}
                  <span className="text-lg font-medium text-gray-200 capitalize">
                    {profile.income_analysis?.income_trend_direction || 'N/A'}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500">Income Volatility</p>
                <p className="text-lg font-medium text-gray-200 mt-1">
                  {formatPercentage(profile.income_analysis?.income_volatility_coefficient)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Recurring Income</p>
                <p className="text-lg font-medium text-gray-200 mt-1">
                  {profile.income_analysis?.recurring_income_detected ? (
                    <span className="text-success-400">
                      {formatCurrency(profile.income_analysis?.recurring_income_total)} detected
                    </span>
                  ) : (
                    <span className="text-gray-400">None detected</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Deposit Concentration</p>
                <p className="text-lg font-medium text-gray-200 mt-1">
                  {formatPercentage(profile.income_analysis?.deposit_concentration_ratio)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Largest Single Deposit</p>
                <p className="text-lg font-medium text-gray-200 mt-1">
                  {formatCurrency(profile.income_analysis?.largest_single_deposit)}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-navy-700">
              <ConfidenceBar
                value={profile.income_analysis?.overall_confidence || 0}
                label="Income Analysis Confidence"
              />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <button
          onClick={() => toggleSection('risk')}
          className="w-full card-header flex items-center justify-between hover:bg-navy-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-gold-500" />
            <h3 className="font-semibold text-gray-200">Risk Indicators</h3>
          </div>
          {expandedSections.risk ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {expandedSections.risk && (
          <div className="card-body">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500">Average Daily Balance</p>
                <p className="text-2xl font-semibold text-gray-100 mt-1">
                  {formatCurrency(profile.bank_statement_analysis?.average_daily_balance)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">NSF/Overdraft Count</p>
                <p
                  className={`text-2xl font-semibold mt-1 ${
                    profile.bank_statement_analysis?.nsf_or_overdraft_count > 0
                      ? 'text-error-400'
                      : 'text-success-400'
                  }`}
                >
                  {profile.bank_statement_analysis?.nsf_or_overdraft_count || 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Negative Balance Days</p>
                <p
                  className={`text-2xl font-semibold mt-1 ${
                    profile.bank_statement_analysis?.number_of_negative_balance_days > 0
                      ? 'text-warning-400'
                      : 'text-success-400'
                  }`}
                >
                  {profile.bank_statement_analysis?.number_of_negative_balance_days || 0}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-navy-700">
              <ConfidenceBar
                value={profile.bank_statement_analysis?.overall_confidence || 0}
                label="Risk Analysis Confidence"
              />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <button
          onClick={() => toggleSection('ratios')}
          className="w-full card-header flex items-center justify-between hover:bg-navy-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-gold-500" />
            <h3 className="font-semibold text-gray-200">Computed Ratios</h3>
          </div>
          {expandedSections.ratios ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {expandedSections.ratios && (
          <div className="card-body">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-navy-900 rounded-lg">
                <p className="text-sm text-gray-500">Estimated DSCR</p>
                <p
                  className={`text-3xl font-semibold mt-2 ${
                    profile.computed_ratios?.estimated_dscr !== null
                      ? profile.computed_ratios.estimated_dscr >= 1.25
                        ? 'text-success-400'
                        : profile.computed_ratios.estimated_dscr >= 1.0
                        ? 'text-gold-400'
                        : 'text-error-400'
                      : 'text-gray-400'
                  }`}
                >
                  {formatRatio(profile.computed_ratios?.estimated_dscr)}
                </p>
                <div className="mt-3">
                  <ConfidenceBar
                    value={profile.computed_ratios?.dscr_confidence || 0}
                    size="sm"
                    showPercentage={false}
                  />
                </div>
              </div>
              <div className="p-4 bg-navy-900 rounded-lg">
                <p className="text-sm text-gray-500">Liquidity Ratio</p>
                <p
                  className={`text-3xl font-semibold mt-2 ${
                    profile.computed_ratios?.liquidity_ratio !== null
                      ? profile.computed_ratios.liquidity_ratio >= 1.0
                        ? 'text-success-400'
                        : profile.computed_ratios.liquidity_ratio >= 0.5
                        ? 'text-gold-400'
                        : 'text-error-400'
                      : 'text-gray-400'
                  }`}
                >
                  {formatRatio(profile.computed_ratios?.liquidity_ratio)}
                </p>
                <div className="mt-3">
                  <ConfidenceBar
                    value={profile.computed_ratios?.liquidity_confidence || 0}
                    size="sm"
                    showPercentage={false}
                  />
                </div>
              </div>
              <div className="p-4 bg-navy-900 rounded-lg">
                <p className="text-sm text-gray-500">Income Volatility</p>
                <p
                  className={`text-3xl font-semibold mt-2 ${
                    profile.computed_ratios?.income_volatility_ratio !== null
                      ? profile.computed_ratios.income_volatility_ratio <= 0.2
                        ? 'text-success-400'
                        : profile.computed_ratios.income_volatility_ratio <= 0.3
                        ? 'text-gold-400'
                        : 'text-error-400'
                      : 'text-gray-400'
                  }`}
                >
                  {formatPercentage(profile.computed_ratios?.income_volatility_ratio)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Coefficient of Variation</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <button
          onClick={() => toggleSection('placerbot')}
          className="w-full card-header flex items-center justify-between hover:bg-navy-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-gold-500" />
            <h3 className="font-semibold text-gray-200">PlacerBot Analysis</h3>
          </div>
          {expandedSections.placerbot ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {expandedSections.placerbot && (
          <div className="p-4">
            <PlacerBotPanel
              submissionId={submissionId}
              loanData={{
                borrowerType: submission.borrowers?.entity_type === 'individual' ? 'individual' : 'entity',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
