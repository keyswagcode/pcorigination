import { runPlacerBotFull, formatForUI } from './placerbot/placerBotOrchestrator';
import type { LoanPackage } from '../shared/types';

export type { LoanPackage };

export async function runPlacerBot(submissionId: string, loanPackage: LoanPackage) {
  const coreOutput = runPlacerBotFull(loanPackage);
  const uiOutput = formatForUI(coreOutput);

  const eligiblePrograms = uiOutput.results.filter(r => r.eligible);
  const hasEligible = eligiblePrograms.length > 0;
  const bestScore = Math.max(...uiOutput.results.map(r => r.score), 0);

  const allConditions = uiOutput.results.flatMap(r => {
    const conditions: Array<{ category?: string; condition: string; severity: 'requirement' | 'restriction' | 'note' }> = [];

    r.qualification_gaps.forEach(gap => {
      conditions.push({ category: 'qualification', condition: gap, severity: 'requirement' });
    });

    r.blocking_reasons.forEach(reason => {
      conditions.push({ category: 'eligibility', condition: reason, severity: 'restriction' });
    });

    return conditions;
  });

  function getConditionKey(condition: string): string {
    const ltvMatch = condition.match(/LTV\s+[\d.]+%\s+exceeds/i);
    if (ltvMatch) return 'ltv_exceeds';

    const dscrMatch = condition.match(/DSCR\s+[\d.]+\s+below/i);
    if (dscrMatch) return 'dscr_below';

    const creditMatch = condition.match(/Credit\s+score\s+\d+\s+below/i);
    if (creditMatch) return 'credit_below';

    const loanAmountMatch = condition.match(/Loan\s+amount.*(?:exceeds|below)/i);
    if (loanAmountMatch) return 'loan_amount_issue';

    return condition;
  }

  const uniqueConditions = Array.from(
    new Map(allConditions.map(c => [getConditionKey(c.condition), c])).values()
  );

  const letterNumber = `PA-${Date.now().toString(36).toUpperCase()}`;

  const requestedAmount = loanPackage.loan_terms.requested_amount;
  const qualificationMax = requestedAmount * (hasEligible ? 1.15 : 1.0);
  const qualificationMin = requestedAmount * (hasEligible ? 0.85 : 0.7);

  const baseRate = 0.07;
  const creditAdjustment = ((loanPackage.borrower_profile.credit_score || 720) - 720) * -0.0002;
  const indicativeMin = Math.max(0.055, baseRate + creditAdjustment - 0.005);
  const indicativeMax = indicativeMin + 0.015;

  const verifiedLiquidity = loanPackage.financial_metrics.total_available_cash || 0;
  const requiredLiquidity = requestedAmount * 0.03;
  const passesLiquidityCheck = verifiedLiquidity >= requiredLiquidity;

  const bestProgram = eligiblePrograms.length > 0
    ? (() => {
        const best = eligiblePrograms.reduce((a, b) => a.score > b.score ? a : b);
        return {
          program_id: `${best.lender}-${best.program}`.toLowerCase().replace(/\s+/g, '-'),
          lender_name: best.lender,
          program_name: best.program,
          match_score: best.score,
          fit_category: best.fit_category,
          eligible: best.eligible,
          blocking_reasons: best.blocking_reasons,
          passing_criteria: best.passing_criteria,
          qualification_gaps: best.qualification_gaps,
          why_this_matches: best.why_this_matches,
          strategy_reason: best.strategy_reason,
          indicative_rate: null,
          explanation: best.strategy_reason,
        };
      })()
    : null;

  const machineDecision = hasEligible ? 'APPROVED' : (bestScore >= 50 ? 'CONDITIONAL' : 'REVIEW_REQUIRED');
  const machineConfidence = bestScore;

  const simpleConditions = uniqueConditions.map(c => c.condition);

  return {
    submission_id: submissionId,
    placerbot_result: uiOutput,
    pre_approval: {
      status: hasEligible ? 'approved' : 'conditional',
      sub_status: hasEligible ? 'pre_approved' : 'needs_review',
      requested_loan_amount: requestedAmount,
      verified_liquidity: verifiedLiquidity,
      required_liquidity: requiredLiquidity,
      passes_liquidity_check: passesLiquidityCheck,
      qualification_min: qualificationMin,
      qualification_max: qualificationMax,
      recommended_amount: requestedAmount,
      conditions: simpleConditions,
      placerbot_conditions: uniqueConditions,
      matched_programs: uiOutput.results.map(r => ({
        program_id: `${r.lender}-${r.program}`.toLowerCase().replace(/\s+/g, '-'),
        lender_name: r.lender,
        program_name: r.program,
        match_score: Math.min(r.score, 100),
        fit_category: r.fit_category,
        eligible: r.eligible,
        blocking_reasons: r.blocking_reasons,
        passing_criteria: r.passing_criteria,
        qualification_gaps: r.qualification_gaps,
        why_this_matches: r.why_this_matches,
        strategy_reason: r.strategy_reason,
        indicative_rate: null,
        explanation: r.strategy_reason,
        key_insight: r.key_insight,
        near_misses: r.qualification_gaps,
      })),
      best_program: bestProgram,
      indicative_rate_range: {
        min: indicativeMin,
        max: indicativeMax,
      },
      machine_decision: machineDecision,
      machine_confidence: machineConfidence,
      letter_number: letterNumber,
      has_qualifying_lender: hasEligible,
      confidence_score: bestScore,
      routing_summary: coreOutput.summary,
      recommended_loan_type: coreOutput.recommended_loan_type,
      engine_details: uiOutput.engine_details,
    },
  };
}
