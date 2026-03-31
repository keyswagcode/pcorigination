import { useState, useEffect } from 'react';
import { CheckCircle as CheckCircle2, Circle as XCircle, AlertTriangle, ChevronDown, ChevronRight, Building2, TrendingUp, Shield, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  checkCreditEligibility,
  checkLTVEligibility,
  checkDSCREligibility,
  checkPropertyEligibility,
  checkLoanAmountEligibility,
} from '../../services/eligibilityFilter';
import type { EligibilityCheck } from '../../services/eligibilityFilter';

interface LenderRulebookPanelProps {
  submissionId: string;
}

interface LenderProgram {
  id: string;
  lender_id: string;
  program_name: string;
  loan_type: string | null;
  occupancy_types: string[] | null;
  min_loan_amount: number | null;
  max_loan_amount: number | null;
  min_credit_score: number | null;
  max_ltv: number | null;
  min_dscr: number | null;
  dscr_required: boolean | null;
  is_active: boolean;
  lender_name: string;
  pricing_model?: string | null;
  loan_types_supported?: string[] | null;
  property_types_supported?: string[] | null;
}

interface BorrowerSnapshot {
  credit_score: number | null;
  ltv: number | null;
  dscr: number | null;
  loan_amount: number | null;
  loan_type: string | null;
  property_type: string | null;
  property_state: string | null;
}

interface EvaluatedProgram extends LenderProgram {
  checks: EligibilityCheck[];
  eligible: boolean;
  blocking_count: number;
}

function RuleChip({ check }: { check: EligibilityCheck }) {
  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${check.passed ? 'bg-green-50' : 'bg-red-50'}`}>
      {check.passed
        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
        : <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
      }
      <span className={check.passed ? 'text-green-800' : 'text-red-800'}>{check.detail}</span>
    </div>
  );
}

function formatPercent(val: number | null): string {
  if (val == null) return '—';
  const pct = val > 1 ? val : val * 100;
  return `${pct.toFixed(1)}%`;
}

function formatCurrency(val: number | null): string {
  if (val == null) return '—';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
}

export function LenderRulebookPanel({ submissionId }: LenderRulebookPanelProps) {
  const [programs, setPrograms] = useState<EvaluatedProgram[]>([]);
  const [borrower, setBorrower] = useState<BorrowerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'ineligible'>('all');

  useEffect(() => {
    loadData();
  }, [submissionId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [submissionResult, lenderProgramsResult] = await Promise.all([
        supabase
          .from('intake_submissions')
          .select(`
            loan_requests (
              requested_amount,
              loan_purpose,
              loan_type
            ),
            properties (
              address_state,
              property_type
            ),
            pre_approvals (
              ltv,
              dscr,
              estimated_dscr
            )
          `)
          .eq('id', submissionId)
          .maybeSingle(),
        supabase
          .from('lender_programs')
          .select(`
            id, lender_id, program_name, loan_type, occupancy_types,
            min_loan_amount, max_loan_amount, min_credit_score,
            max_ltv, min_dscr, dscr_required, is_active,
            pricing_model, loan_types_supported, property_types_supported,
            lenders (name)
          `)
          .eq('is_active', true)
          .order('program_name'),
      ]);

      const sub = submissionResult.data;
      const loanReq = Array.isArray(sub?.loan_requests) ? sub.loan_requests[0] : sub?.loan_requests;
      const prop = Array.isArray(sub?.properties) ? sub.properties[0] : sub?.properties;
      const preApproval = Array.isArray(sub?.pre_approvals) ? sub.pre_approvals[0] : sub?.pre_approvals;

      const snap: BorrowerSnapshot = {
        credit_score: null,
        ltv: preApproval?.ltv ? parseFloat(preApproval.ltv) : null,
        dscr: preApproval?.dscr
          ? parseFloat(preApproval.dscr)
          : preApproval?.estimated_dscr
          ? parseFloat(preApproval.estimated_dscr)
          : null,
        loan_amount: loanReq?.requested_amount ? parseFloat(loanReq.requested_amount) : null,
        loan_type: loanReq?.loan_purpose || loanReq?.loan_type || null,
        property_type: prop?.property_type || null,
        property_state: prop?.address_state || null,
      };

      setBorrower(snap);

      const rawPrograms = lenderProgramsResult.data || [];
      const evaluated: EvaluatedProgram[] = rawPrograms.map((p: any) => {
        const lenderName = p.lenders?.name || 'Unknown Lender';

        const checks: EligibilityCheck[] = [
          checkCreditEligibility(snap.credit_score, p.min_credit_score),
          checkLTVEligibility(snap.ltv ?? 0, p.max_ltv),
          checkDSCREligibility(snap.dscr, p.min_dscr, p.dscr_required || false),
          checkPropertyEligibility(
            snap.property_state || '',
            snap.loan_type || '',
            snap.property_type,
            { loan_type: p.loan_type, occupancy_types: p.occupancy_types }
          ),
          checkLoanAmountEligibility(snap.loan_amount ?? 0, p.min_loan_amount, p.max_loan_amount),
        ];

        const blockingCount = checks.filter(c => !c.passed).length;
        return {
          ...p,
          lender_name: lenderName,
          checks,
          eligible: blockingCount === 0,
          blocking_count: blockingCount,
        };
      });

      evaluated.sort((a, b) => {
        if (a.eligible && !b.eligible) return -1;
        if (!a.eligible && b.eligible) return 1;
        return a.blocking_count - b.blocking_count;
      });

      setPrograms(evaluated);
    } catch (err) {
      console.error('LenderRulebookPanel error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = programs.filter(p => {
    if (filter === 'eligible') return p.eligible;
    if (filter === 'ineligible') return !p.eligible;
    return true;
  });

  const eligibleCount = programs.filter(p => p.eligible).length;
  const ineligibleCount = programs.filter(p => !p.eligible).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
        <span className="ml-3 text-gray-500">Loading lender rulebook...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {borrower && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-600" />
            Borrower Underwriting Profile
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Credit Score', value: borrower.credit_score?.toString() || '—' },
              { label: 'LTV', value: formatPercent(borrower.ltv) },
              { label: 'DSCR', value: borrower.dscr ? borrower.dscr.toFixed(2) : '—' },
              { label: 'Loan Amount', value: formatCurrency(borrower.loan_amount) },
              { label: 'Loan Type', value: borrower.loan_type || '—' },
              { label: 'Property Type', value: borrower.property_type || '—' },
              { label: 'Property State', value: borrower.property_state || '—' },
            ].map(item => (
              <div key={item.label} className="bg-white rounded-lg p-3 border border-gray-100">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="font-semibold text-gray-900 mt-0.5 capitalize">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-gray-700">{eligibleCount} Eligible</span>
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-medium text-gray-700">{ineligibleCount} Ineligible</span>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['all', 'eligible', 'ineligible'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                filter === f
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No lender programs found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((program) => {
            const isExpanded = expandedId === program.id;
            return (
              <div
                key={program.id}
                className={`border rounded-xl overflow-hidden transition-all ${
                  program.eligible
                    ? 'border-green-200 bg-green-50/30'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <button
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50/60 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : program.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${program.eligible ? 'bg-green-100' : 'bg-gray-100'}`}>
                      {program.eligible
                        ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                        : <XCircle className="w-4 h-4 text-gray-400" />
                      }
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{program.program_name}</p>
                      <p className="text-xs text-gray-500">{program.lender_name}</p>
                    </div>
                    {!program.eligible && (
                      <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                        {program.blocking_count} issue{program.blocking_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="hidden sm:block">{program.loan_type ? program.loan_type.toUpperCase() : 'All Types'}</span>
                    <span className="hidden sm:flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {formatCurrency(program.min_loan_amount)} – {formatCurrency(program.max_loan_amount)}
                    </span>
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4" />
                      : <ChevronRight className="w-4 h-4" />
                    }
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 mb-3">
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">Min Credit Score</p>
                        <p className="font-semibold text-gray-800 text-sm">{program.min_credit_score ?? '—'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">Max LTV</p>
                        <p className="font-semibold text-gray-800 text-sm">{formatPercent(program.max_ltv)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">Min DSCR</p>
                        <p className="font-semibold text-gray-800 text-sm">{program.min_dscr ? program.min_dscr.toFixed(2) : 'N/A'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">Loan Range</p>
                        <p className="font-semibold text-gray-800 text-sm">{formatCurrency(program.min_loan_amount)} – {formatCurrency(program.max_loan_amount)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">Loan Type</p>
                        <p className="font-semibold text-gray-800 text-sm capitalize">{program.loan_type || 'All'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-400">DSCR Required</p>
                        <p className="font-semibold text-gray-800 text-sm">{program.dscr_required ? 'Yes' : 'No'}</p>
                      </div>
                    </div>

                    <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Eligibility Checks
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {program.checks.map((check) => (
                        <RuleChip key={check.rule} check={check} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
