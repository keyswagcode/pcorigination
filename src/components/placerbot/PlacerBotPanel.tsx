import { useState, useEffect } from 'react';
import { Bot, Loader as Loader2, TrendingUp, AlertTriangle, CheckCircle, Circle as XCircle, Lightbulb, ArrowRight } from 'lucide-react';
import { runServerPlacement } from '../../services/placementService';
import { buildLoanPackage } from '../../services/loanPackagingService';
import type { PlacementResult } from '../../shared/types';

interface PlacerBotPanelProps {
  submissionId: string;
  loanData?: {
    requestedAmount?: number;
    purchasePrice?: number;
    loanType?: string;
    propertyState?: string;
    propertyCity?: string;
    borrowerType?: 'individual' | 'entity';
    creditScore?: number;
    estimatedDscr?: number;
  };
}

const FIT_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  strong_fit: { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-700', label: 'Strong Fit' },
  good_fit: { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700', label: 'Good Fit' },
  conditional_fit: { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700', label: 'Conditional' },
  closest_option: { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-700', label: 'Closest Option' },
  no_fit: { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-700', label: 'No Fit' },
};

export function PlacerBotPanel({ submissionId, loanData }: PlacerBotPanelProps) {
  const [results, setResults] = useState<PlacementResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);

    try {
      const pkg = await buildLoanPackage(submissionId, {
        loanAmount: loanData?.requestedAmount || 0,
        purchasePrice: loanData?.purchasePrice || 0,
        loanType: loanData?.loanType || 'dscr',
        propertyAddress: '',
        propertyCity: loanData?.propertyCity || '',
        propertyState: loanData?.propertyState || '',
        propertyZip: '',
        borrowerType: loanData?.borrowerType || 'individual',
        creditScore: loanData?.creditScore || 720,
        estimatedDscr: loanData?.estimatedDscr,
      });

      const response = await runServerPlacement(submissionId, pkg);
      const preApproval = response.pre_approval as { matched_programs?: PlacementResult[] } | undefined;
      const matched = preApproval?.matched_programs || [];
      setResults(matched as PlacementResult[]);
      setHasRun(true);
    } catch (err) {
      setError('Failed to run placement analysis');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (submissionId) {
      runAnalysis();
    }
  }, [submissionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
        <span>Running placement analysis...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-700">{error}</p>
        <button
          onClick={runAnalysis}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!hasRun) {
    return (
      <div className="text-center py-12">
        <Bot className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500 mb-4">Run PlacerBot to find matching lender programs</p>
        <button
          onClick={runAnalysis}
          className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium"
        >
          Run Analysis
        </button>
      </div>
    );
  }

  const eligible = results.filter(r => r.eligible);
  const closestOptions = results.filter(r => !r.eligible && r.fit_category === 'closest_option');
  const noFit = results.filter(r => !r.eligible && r.fit_category !== 'closest_option');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-teal-600" />
          <span className="font-semibold text-gray-900">PlacerBot Results</span>
          <span className="text-sm text-gray-500">({results.length} programs evaluated)</span>
        </div>
        <button
          onClick={runAnalysis}
          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
        >
          Re-run
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-green-700">{eligible.length}</p>
          <p className="text-xs text-green-600 mt-0.5">Eligible</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-orange-700">{closestOptions.length}</p>
          <p className="text-xs text-orange-600 mt-0.5">Closest Options</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gray-700">{noFit.length}</p>
          <p className="text-xs text-gray-600 mt-0.5">No Fit</p>
        </div>
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-teal-700">{results.length}</p>
          <p className="text-xs text-teal-600 mt-0.5">Total</p>
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => {
            const fitStyle = FIT_STYLES[result.fit_category] || FIT_STYLES.no_fit;
            const nearMisses = result.near_misses || [];
            const salvageSuggestions = result.salvage_suggestions || [];
            const showNearMisses = nearMisses.length > 0;
            const showSuggestions = salvageSuggestions.length > 0;

            return (
              <div
                key={result.program_id}
                className={`border rounded-xl p-4 ${
                  result.eligible
                    ? 'border-green-200 bg-green-50/30'
                    : result.fit_category === 'closest_option'
                      ? 'border-orange-200 bg-orange-50/20'
                      : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {result.eligible
                        ? <CheckCircle className="w-4 h-4 text-green-600" />
                        : result.fit_category === 'closest_option'
                          ? <AlertTriangle className="w-4 h-4 text-orange-500" />
                          : <XCircle className="w-4 h-4 text-red-400" />
                      }
                      <p className="font-medium text-gray-900">{result.lender_name}</p>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5 ml-6">{result.program_name}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${fitStyle.bg} ${fitStyle.text}`}>
                      {fitStyle.label}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">Score: {result.match_score}</p>
                  </div>
                </div>

                {result.indicative_rate && (
                  <div className="flex items-center gap-2 text-sm text-teal-700 font-medium ml-6 mb-2">
                    <TrendingUp className="w-4 h-4" />
                    Indicative Rate: {(result.indicative_rate * 100).toFixed(2)}%
                  </div>
                )}

                <div className="ml-6 mt-3 border-t border-gray-200 pt-3 space-y-3">
                  {result.passing_criteria?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-green-700 mb-1.5">What you meet:</p>
                      <div className="space-y-1">
                        {result.passing_criteria.map((criterion, i) => (
                          <div key={`p-${i}`} className="flex items-start gap-2 text-xs text-green-600">
                            <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{criterion}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {showNearMisses && (
                    <div>
                      <p className="text-xs font-medium text-amber-600 mb-1.5">Near misses:</p>
                      <div className="space-y-1">
                        {nearMisses.map((miss, i) => (
                          <div key={`nm-${i}`} className="flex items-start gap-2 text-xs text-amber-600">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{miss}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.blocking_reasons.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-red-600 mb-1.5">Hard stops:</p>
                      <div className="space-y-1">
                        {result.blocking_reasons.map((reason, i) => (
                          <div key={`b-${i}`} className="flex items-start gap-2 text-xs text-red-600">
                            <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {showSuggestions && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mt-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-2">
                        <Lightbulb className="w-3.5 h-3.5" />
                        Structuring suggestions:
                      </div>
                      <div className="space-y-2">
                        {salvageSuggestions.map((suggestion, i) => (
                          <div key={`s-${i}`} className="text-xs">
                            <div className="flex items-center gap-2 text-blue-600">
                              <span className="font-medium">{suggestion.field}:</span>
                              <span className="text-gray-500">{suggestion.current_value}</span>
                              <ArrowRight className="w-3 h-3 text-gray-400" />
                              <span className="text-blue-700">{suggestion.required_value}</span>
                            </div>
                            <p className="text-gray-600 mt-0.5 pl-0">{suggestion.fix}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {result.explanation && result.eligible && !showNearMisses && (
                  <p className="ml-6 mt-2 text-xs text-gray-500">{result.explanation}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Bot className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">No programs found</p>
        </div>
      )}
    </div>
  );
}
