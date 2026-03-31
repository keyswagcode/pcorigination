import { supabase } from './supabaseClient';
import type { LoanPackage, PlacementResult } from '../shared/types';
import { evaluateLoanPackage } from './lenderRulesService';

function buildExplanation(
  eligible: boolean,
  blockingReasons: string[],
  programName: string,
  lenderName: string,
  strategyReason?: string
): string {
  if (!eligible && blockingReasons.length > 0) {
    return `${lenderName} — ${programName}: ${blockingReasons.slice(0, 2).join('; ')}.`;
  }
  if (strategyReason) {
    return `${lenderName} — ${strategyReason}`;
  }
  return `${lenderName} — ${programName} is eligible based on credit, LTV, and loan amount criteria.`;
}

export async function runPlacementEngine(
  _applicationId: string,
  loanPackage: LoanPackage
): Promise<PlacementResult[]> {
  const eligibility = await evaluateLoanPackage(loanPackage);

  const results: PlacementResult[] = eligibility.map((e) => {
    return {
      program_id: e.program_id,
      lender_name: e.lender_name,
      program_name: e.program_name,
      match_score: e.score ?? 50,
      fit_category: e.fit_category ?? (e.eligible ? 'good_fit' : 'no_fit'),
      eligible: e.eligible,
      blocking_reasons: e.blocking_reasons,
      passing_criteria: e.passing_criteria ?? [],
      near_misses: e.qualification_gaps ?? [],
      salvage_suggestions: e.salvage_suggestions ?? [],
      indicative_rate: null,
      explanation: buildExplanation(e.eligible, e.blocking_reasons, e.program_name, e.lender_name, e.strategy_reason),
    };
  });

  return results.sort((a, b) => b.match_score - a.match_score);
}

export async function runServerPlacement(
  submissionId: string,
  loanPackage: LoanPackage
): Promise<{ pre_approval: unknown }> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-preapproval`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        submission_id: submissionId,
        loan_package: loanPackage,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Placement service failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchPreApprovalsForApplication(submissionId: string) {
  const { data } = await supabase
    .from('pre_approvals')
    .select('*')
    .eq('intake_submission_id', submissionId)
    .order('created_at', { ascending: false });

  return data || [];
}

export async function fetchPreApprovalsForUser(userId: string) {
  const { data } = await supabase
    .from('pre_approvals')
    .select('id, status, recommended_amount, qualification_min, qualification_max, passes_liquidity_check, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  return data || [];
}
