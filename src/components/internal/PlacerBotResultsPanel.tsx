import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Bot,
  CheckCircle,
  XCircle,
  TrendingUp,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface PlacerBotResultsPanelProps {
  borrowerId: string;
}

interface UnderwritingResult {
  id: string;
  recommended_loan_type: string | null;
  routing_result_json: Record<string, unknown> | null;
  lender_matches_json: Record<string, unknown> | null;
  summary: string | null;
  confidence_score: number | null;
  generated_at: string;
}

interface LenderMatch {
  lender: string;
  program: string;
  score: number;
  fit_category: string;
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  qualification_gaps?: string[];
  salvage_suggestions?: Array<{ field: string; current_value: string; required_value: string; fix: string }>;
}

export function PlacerBotResultsPanel({ borrowerId }: PlacerBotResultsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [running] = useState(false);
  const [result, setResult] = useState<UnderwritingResult | null>(null);
  const [expandedLender, setExpandedLender] = useState<string | null>(null);

  useEffect(() => {
    loadResults();
  }, [borrowerId]);

  async function loadResults() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('borrower_underwriting_results')
        .select('*')
        .eq('borrower_id', borrowerId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  const getFitCategoryStyle = (category: string) => {
    switch (category) {
      case 'strong_fit':
        return { bg: 'bg-green-100', text: 'text-green-700', label: 'Strong Fit' };
      case 'good_fit':
        return { bg: 'bg-teal-100', text: 'text-teal-700', label: 'Good Fit' };
      case 'conditional_fit':
        return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Conditional' };
      case 'closest_option':
        return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Closest Option' };
      default:
        return { bg: 'bg-red-100', text: 'text-red-700', label: 'No Fit' };
    }
  };

  const lenderMatches: LenderMatch[] = result?.lender_matches_json
    ? (Array.isArray(result.lender_matches_json) ? result.lender_matches_json : [])
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
        <Bot className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">No Underwriting Results</p>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          Run PlacerBot analysis to generate lender matches and recommendations
        </p>
        <button
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50"
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Bot className="w-4 h-4" />
              Run PlacerBot
            </>
          )}
        </button>
      </div>
    );
  }

  const eligibleCount = lenderMatches.filter(m => m.eligible).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">PlacerBot Analysis</h3>
            <p className="text-sm text-gray-500">
              Generated {new Date(result.generated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <button
          disabled={running}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-teal-600 hover:bg-teal-50 rounded-lg"
        >
          <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
          Re-run
        </button>
      </div>

      {result.summary && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <p className="text-sm text-slate-700">{result.summary}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Recommended Type</p>
          <p className="text-lg font-bold text-gray-900 mt-1 uppercase">
            {result.recommended_loan_type || '-'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Eligible Lenders</p>
          <p className="text-lg font-bold text-green-600 mt-1">
            {eligibleCount} / {lenderMatches.length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Confidence</p>
          <p className={`text-lg font-bold mt-1 ${
            (result.confidence_score || 0) >= 70 ? 'text-green-600' :
            (result.confidence_score || 0) >= 50 ? 'text-amber-600' :
            'text-red-600'
          }`}>
            {result.confidence_score ? `${result.confidence_score.toFixed(0)}%` : '-'}
          </p>
        </div>
      </div>

      {lenderMatches.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">Lender Matches</h4>
          <div className="space-y-3">
            {lenderMatches.map((match, index) => {
              const fitStyle = getFitCategoryStyle(match.fit_category);
              const isExpanded = expandedLender === `${match.lender}-${match.program}`;

              return (
                <div
                  key={index}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedLender(isExpanded ? null : `${match.lender}-${match.program}`)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {match.eligible ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                      <div className="text-left">
                        <p className="font-medium text-gray-900">{match.lender}</p>
                        <p className="text-sm text-gray-500">{match.program}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${fitStyle.bg} ${fitStyle.text}`}>
                        {fitStyle.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">{match.score}%</span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-200 pt-4 space-y-4">
                      {match.passing_criteria && match.passing_criteria.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-green-700 mb-2">Passing Criteria</p>
                          <ul className="space-y-1">
                            {match.passing_criteria.map((criteria, i) => (
                              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                {criteria}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {match.blocking_reasons && match.blocking_reasons.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-red-700 mb-2">Blocking Reasons</p>
                          <ul className="space-y-1">
                            {match.blocking_reasons.map((reason, i) => (
                              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {match.salvage_suggestions && match.salvage_suggestions.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-amber-700 mb-2">Salvage Suggestions</p>
                          <ul className="space-y-2">
                            {match.salvage_suggestions.map((suggestion, i) => (
                              <li key={i} className="text-sm bg-amber-50 p-3 rounded-lg">
                                <p className="font-medium text-amber-800">{suggestion.field}</p>
                                <p className="text-amber-700 mt-1">
                                  Current: {suggestion.current_value} - Required: {suggestion.required_value}
                                </p>
                                <p className="text-amber-600 mt-1 text-xs">{suggestion.fix}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
