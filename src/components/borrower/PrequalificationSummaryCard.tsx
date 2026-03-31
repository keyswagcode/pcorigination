import type { PrequalResult } from '../../shared/types';
import { DollarSign, TrendingUp, Info } from 'lucide-react';

interface PrequalificationSummaryCardProps {
  prequal: PrequalResult;
}

export function PrequalificationSummaryCard({ prequal }: PrequalificationSummaryCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatRate = (rate: number) => {
    return `${(rate * 100).toFixed(2)}%`;
  };

  return (
    <div className="bg-gradient-to-br from-teal-600 to-teal-700 rounded-xl p-6 text-white">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-teal-100 text-sm font-medium">Pre-Approved Amount</p>
          <p className="text-3xl font-bold mt-1">
            {formatCurrency(prequal.prequalified_amount)}
          </p>
        </div>
        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
          <DollarSign className="w-6 h-6" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {prequal.qualification_range_low && prequal.qualification_range_high && (
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-teal-100 text-xs font-medium">Qualification Range</p>
            <p className="text-lg font-semibold mt-1">
              {formatCurrency(prequal.qualification_range_low)} - {formatCurrency(prequal.qualification_range_high)}
            </p>
          </div>
        )}

        {prequal.estimated_rate_low && prequal.estimated_rate_high && (
          <div className="bg-white/10 rounded-lg p-3">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-teal-200" />
              <p className="text-teal-100 text-xs font-medium">Est. Rate Range</p>
            </div>
            <p className="text-lg font-semibold mt-1">
              {formatRate(prequal.estimated_rate_low)} - {formatRate(prequal.estimated_rate_high)}
            </p>
          </div>
        )}
      </div>

      {prequal.summary && (
        <p className="text-teal-100 text-sm leading-relaxed">
          {prequal.summary}
        </p>
      )}

      <div className="mt-4 pt-4 border-t border-white/20 flex items-start gap-2">
        <Info className="w-4 h-4 text-teal-200 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-teal-200">
          This pre-approval is based on your financial profile. Final loan terms are subject to
          property evaluation and full underwriting review.
        </p>
      </div>
    </div>
  );
}
