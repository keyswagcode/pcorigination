import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { BorrowerFinancialProfile } from '../../shared/types';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

interface ExtractedFinancialsPanelProps {
  financialProfile: BorrowerFinancialProfile | null;
  borrowerId: string;
}

interface BankMetrics {
  total_deposits: number;
  total_withdrawals: number;
  avg_monthly_deposits: number;
  avg_monthly_balance: number;
  ending_balance: number;
  nsf_count: number;
}

export function ExtractedFinancialsPanel({ financialProfile, borrowerId }: ExtractedFinancialsPanelProps) {
  const [bankMetrics, setBankMetrics] = useState<BankMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBankMetrics();
  }, [borrowerId]);

  async function loadBankMetrics() {
    setLoading(true);
    try {
      const { data: accounts } = await supabase
        .from('normalized_bank_accounts')
        .select('*')
        .eq('borrower_id', borrowerId);

      if (accounts && accounts.length > 0) {
        const metrics: BankMetrics = {
          total_deposits: accounts.reduce((sum, a) => sum + (a.total_deposits || 0), 0),
          total_withdrawals: accounts.reduce((sum, a) => sum + (a.total_withdrawals || 0), 0),
          avg_monthly_deposits: accounts.reduce((sum, a) => sum + (a.avg_monthly_deposits || 0), 0) / accounts.length,
          avg_monthly_balance: accounts.reduce((sum, a) => sum + (a.avg_monthly_balance || 0), 0) / accounts.length,
          ending_balance: accounts.reduce((sum, a) => sum + (a.ending_balance || 0), 0),
          nsf_count: accounts.reduce((sum, a) => sum + (a.nsf_count || 0), 0)
        };
        setBankMetrics(metrics);
      }
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getConfidenceColor = (score: number | null | undefined) => {
    if (!score) return 'text-gray-400';
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!financialProfile && !bankMetrics) {
    return (
      <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
        <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">No Financial Data Available</p>
        <p className="text-sm text-gray-500 mt-1">
          Financial data will appear after documents are processed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-green-700">Avg Monthly Deposits</span>
          </div>
          <p className="text-xl font-bold text-green-800">
            {formatCurrency(financialProfile?.avg_monthly_deposits || bankMetrics?.avg_monthly_deposits)}
          </p>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-medium text-blue-700">Liquidity Estimate</span>
          </div>
          <p className="text-xl font-bold text-blue-800">
            {formatCurrency(financialProfile?.liquidity_estimate || bankMetrics?.ending_balance)}
          </p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-medium text-purple-700">Income Estimate</span>
          </div>
          <p className="text-xl font-bold text-purple-800">
            {formatCurrency(financialProfile?.income_estimate)}
          </p>
        </div>

        <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-4 border border-teal-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-teal-600" />
            <span className="text-xs font-medium text-teal-700">Cash Flow Estimate</span>
          </div>
          <p className="text-xl font-bold text-teal-800">
            {formatCurrency(financialProfile?.cash_flow_estimate)}
          </p>
        </div>
      </div>

      {financialProfile && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900">Financial Profile</h4>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Confidence:</span>
              <span className={`text-sm font-bold ${getConfidenceColor(financialProfile.confidence_score)}`}>
                {financialProfile.confidence_score ? `${financialProfile.confidence_score.toFixed(0)}%` : '-'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Monthly Income</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.monthly_income)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Avg Monthly Deposits</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.avg_monthly_deposits)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Ending Balance Avg</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.ending_balance_avg)}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Liquidity Estimate</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.liquidity_estimate)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Income Estimate</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.income_estimate)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Cash Flow Estimate</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(financialProfile.cash_flow_estimate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {bankMetrics && bankMetrics.nsf_count > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800">NSF/Overdraft Activity Detected</p>
            <p className="text-sm text-amber-700 mt-1">
              {bankMetrics.nsf_count} NSF or overdraft transactions found in bank statements.
              Consider this during underwriting review.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
