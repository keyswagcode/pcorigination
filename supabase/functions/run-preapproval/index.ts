import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface LoanPackage {
  submission_id: string;
  borrower_profile: {
    borrower_id: string;
    borrower_name: string;
    entity_type: string;
    credit_score: number | null;
    estimated_dscr: number | null;
    borrower_type: string;
    is_foreign_national: boolean;
    is_first_time_investor: boolean;
  };
  loan_terms: {
    requested_amount: number;
    purchase_price: number;
    loan_type: string;
    occupancy_type: string;
    transaction_type: string;
    ltv: number;
  };
  property_details: {
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    property_type: string | null;
    total_units: number | null;
    appraised_value: number | null;
    purchase_price: number;
  };
  financial_metrics: {
    total_available_cash: number;
    total_closing_balance: number;
    avg_monthly_deposits: number;
    avg_monthly_withdrawals: number;
    avg_monthly_net_flow: number;
    avg_monthly_balance: number;
    months_of_data: number;
    accounts_found: number;
  };
  underwriting_metrics: {
    loan_to_value: number;
    debt_service_coverage: number | null;
    borrower_liquidity_ratio: number;
    required_liquidity: number;
    passes_liquidity_check: boolean;
  };
  documents: {
    total_documents: number;
    bank_statements: number;
    processed_documents: number;
    pending_documents: number;
    failed_documents: number;
  };
  packaged_at: string;
}

interface LenderProgram {
  id: string;
  lender_id: string;
  program_name: string;
  loan_type: string;
  min_credit_score: number | null;
  max_ltv: number | null;
  min_dscr: number | null;
  dscr_required: boolean | null;
  min_loan_amount: number | null;
  max_loan_amount: number | null;
  allows_foreign_nationals: boolean | null;
  allows_first_time_investors: boolean | null;
  is_active: boolean;
  notes: string | null;
  lenders: { name: string } | null;
}

type FitCategory = 'strong_fit' | 'good_fit' | 'conditional_fit' | 'closest_option' | 'no_fit';

function isNearLoanMinimum(amount: number, min: number): boolean {
  return amount < min && amount >= min * 0.95;
}

function generateLetterNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PA-${ts}-${rand}`;
}

function evaluateProgram(pkg: LoanPackage, program: LenderProgram): {
  eligible: boolean;
  blocking_reasons: string[];
  passing_criteria: string[];
  near_misses: string[];
  fit_category: FitCategory;
  match_score: number;
  salvage_suggestions: { field: string; current_value: string; required_value: string; fix: string }[];
} {
  const hardStops: string[] = [];
  const passing: string[] = [];
  const nearMisses: string[] = [];
  const salvageSuggestions: { field: string; current_value: string; required_value: string; fix: string }[] = [];

  const credit = pkg.borrower_profile.credit_score;
  const dscr = pkg.underwriting_metrics.debt_service_coverage;
  const ltv = pkg.underwriting_metrics.loan_to_value;
  const loanAmount = pkg.loan_terms.requested_amount;
  let score = 50;

  if (program.min_credit_score != null) {
    if (credit == null) {
      hardStops.push(`Credit score not provided`);
      score -= 15;
    } else if (credit >= program.min_credit_score) {
      passing.push(`Credit score ${credit} meets minimum ${program.min_credit_score}`);
      score += 10;
    } else if (credit >= program.min_credit_score - 15) {
      nearMisses.push(`Credit score ${credit} is near minimum ${program.min_credit_score}`);
      salvageSuggestions.push({
        field: 'Credit Score',
        current_value: String(credit),
        required_value: String(program.min_credit_score),
        fix: `Consider rapid rescore to gain ${program.min_credit_score - credit} points`
      });
      score += 3;
    } else {
      hardStops.push(`Credit score ${credit} below minimum ${program.min_credit_score}`);
      score -= 15;
    }
  }

  if (program.min_dscr != null && program.dscr_required) {
    if (dscr == null) {
      hardStops.push("DSCR not provided but required");
      score -= 10;
    } else if (dscr >= program.min_dscr) {
      passing.push(`DSCR ${dscr.toFixed(2)} meets minimum ${program.min_dscr.toFixed(2)}`);
      score += 10;
    } else if (dscr >= program.min_dscr - 0.05) {
      nearMisses.push(`DSCR ${dscr.toFixed(2)} is near minimum ${program.min_dscr.toFixed(2)}`);
      salvageSuggestions.push({
        field: 'DSCR',
        current_value: dscr.toFixed(2),
        required_value: program.min_dscr.toFixed(2),
        fix: 'Increase rent or reduce loan amount to improve ratio'
      });
      score += 2;
    } else {
      hardStops.push(`DSCR ${dscr.toFixed(2)} below minimum ${program.min_dscr.toFixed(2)}`);
      score -= 15;
    }
  }

  if (program.max_ltv != null) {
    const ltvPct = ltv > 1 ? ltv : ltv * 100;
    const maxPct = program.max_ltv > 1 ? program.max_ltv : program.max_ltv * 100;
    if (ltvPct <= maxPct) {
      passing.push(`LTV ${ltvPct.toFixed(1)}% within maximum ${maxPct.toFixed(1)}%`);
      score += 10;
    } else if (ltvPct <= maxPct + 3) {
      nearMisses.push(`LTV ${ltvPct.toFixed(1)}% is near maximum ${maxPct.toFixed(1)}%`);
      salvageSuggestions.push({
        field: 'LTV',
        current_value: `${ltvPct.toFixed(1)}%`,
        required_value: `${maxPct.toFixed(1)}%`,
        fix: 'Increase down payment or reduce loan amount'
      });
      score += 2;
    } else {
      hardStops.push(`LTV ${ltvPct.toFixed(1)}% exceeds maximum ${maxPct.toFixed(1)}%`);
      score -= 15;
    }
  }

  if (program.min_loan_amount != null) {
    if (loanAmount >= program.min_loan_amount) {
      passing.push(`Loan amount $${loanAmount.toLocaleString()} meets minimum $${program.min_loan_amount.toLocaleString()}`);
      score += 8;
    } else if (isNearLoanMinimum(loanAmount, program.min_loan_amount)) {
      const shortfall = program.min_loan_amount - loanAmount;
      nearMisses.push(`Loan amount $${loanAmount.toLocaleString()} is slightly below minimum $${program.min_loan_amount.toLocaleString()}`);
      salvageSuggestions.push({
        field: 'Loan Amount',
        current_value: `$${loanAmount.toLocaleString()}`,
        required_value: `$${program.min_loan_amount.toLocaleString()}`,
        fix: `Increase loan amount by $${shortfall.toLocaleString()} to meet minimum`
      });
      score += 3;
    } else {
      hardStops.push(`Loan amount $${loanAmount.toLocaleString()} below minimum $${program.min_loan_amount.toLocaleString()}`);
      score -= 12;
    }
  }

  if (program.max_loan_amount != null) {
    if (loanAmount <= program.max_loan_amount) {
      passing.push(`Loan amount within maximum $${program.max_loan_amount.toLocaleString()}`);
      score += 5;
    } else {
      hardStops.push(`Loan amount exceeds maximum $${program.max_loan_amount.toLocaleString()}`);
      score -= 10;
    }
  }

  if (program.allows_foreign_nationals === false && pkg.borrower_profile.is_foreign_national) {
    hardStops.push("Foreign national not permitted");
    score -= 10;
  }

  if (program.allows_first_time_investors === false && pkg.borrower_profile.is_first_time_investor) {
    hardStops.push("First-time investor not permitted");
    score -= 10;
  }

  if (program.loan_type && program.loan_type !== pkg.loan_terms.loan_type) {
    hardStops.push(`Program requires loan type "${program.loan_type}"`);
    score -= 5;
  } else if (program.loan_type) {
    passing.push(`Loan type "${pkg.loan_terms.loan_type}" matches program`);
    score += 5;
  }

  const eligible = hardStops.length === 0;
  let fitCategory: FitCategory;

  if (eligible && nearMisses.length === 0) {
    fitCategory = 'strong_fit';
  } else if (eligible && nearMisses.length === 1) {
    fitCategory = 'good_fit';
  } else if (eligible && nearMisses.length >= 2) {
    fitCategory = 'conditional_fit';
  } else if (!eligible && hardStops.length === 1 && nearMisses.length <= 2) {
    fitCategory = 'closest_option';
  } else {
    fitCategory = 'no_fit';
  }

  let finalScore = Math.max(0, Math.min(100, score));
  if (fitCategory === 'strong_fit') {
    finalScore = Math.max(75, Math.min(90, finalScore));
  } else if (fitCategory === 'good_fit') {
    finalScore = Math.max(65, Math.min(80, finalScore));
  } else if (fitCategory === 'conditional_fit') {
    finalScore = Math.max(55, Math.min(70, finalScore));
  } else if (fitCategory === 'closest_option') {
    finalScore = Math.max(45, Math.min(65, finalScore));
  } else {
    finalScore = Math.max(0, Math.min(45, finalScore));
  }

  return {
    eligible,
    blocking_reasons: hardStops,
    passing_criteria: passing,
    near_misses: nearMisses,
    fit_category: fitCategory,
    match_score: finalScore,
    salvage_suggestions: salvageSuggestions,
  };
}

function buildConditions(pkg: LoanPackage, hasEligible: boolean, hasClosestOptions: boolean, eligibleLenderNames: string[]): string[] {
  const conds: string[] = [];

  conds.push("Final lender selection and underwriting approval");

  if (eligibleLenderNames.length > 0) {
    const lenderList = eligibleLenderNames.slice(0, 3).join(', ');
    conds.push(`Based on ${pkg.loan_terms.loan_type.toUpperCase()} programs (${lenderList})`);
  }

  conds.push("Loan amount and structure must meet lender-specific minimum thresholds");
  conds.push("Verification of income, assets, and employment");
  conds.push("Property appraisal and eligibility confirmation");

  if (!pkg.underwriting_metrics.passes_liquidity_check) {
    conds.push("Proof of sufficient reserves required");
  }

  if (pkg.documents.processed_documents < pkg.documents.bank_statements) {
    conds.push("All uploaded bank statements must be fully processed");
  }

  if (pkg.documents.bank_statements === 0) {
    conds.push("Bank statements must be uploaded and verified");
  }

  if (!hasEligible && hasClosestOptions) {
    conds.push("Minor structuring adjustments may be required per lender guidelines");
  } else if (!hasEligible && !hasClosestOptions) {
    conds.push("Application requires manual underwriting review");
  }

  return conds;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id, loan_package } = await req.json() as {
      submission_id: string;
      loan_package: LoanPackage;
    };

    if (!submission_id || !loan_package) {
      return new Response(
        JSON.stringify({ error: "submission_id and loan_package are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifiedLiquidityCheck = loan_package.financial_metrics.total_available_cash;
    const requiredLiquidityCheck = loan_package.underwriting_metrics.required_liquidity;
    const passesLiquidityGate = verifiedLiquidityCheck >= requiredLiquidityCheck;

    await supabase
      .from("pre_approvals")
      .delete()
      .eq("intake_submission_id", submission_id);

    if (!passesLiquidityGate) {
      return new Response(
        JSON.stringify({
          error: "insufficient_liquidity",
          message: "Cannot generate pre-approval: liquidity requirement not met",
          pre_approval: {
            status: "pending_review",
            sub_status: "liquidity_review_required",
            requested_loan_amount: loan_package.loan_terms.requested_amount,
            verified_liquidity: verifiedLiquidityCheck,
            required_liquidity: requiredLiquidityCheck,
            passes_liquidity_check: false,
            qualification_min: null,
            qualification_max: null,
            recommended_amount: null,
            conditions: ["Proof of sufficient reserves required"],
            placerbot_conditions: [],
            matched_programs: [],
            best_program: null,
            indicative_rate_range: null,
            machine_decision: "pending_review",
            machine_confidence: 0,
            letter_number: null,
            has_qualifying_lender: false,
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: programs } = await supabase
      .from("lender_programs")
      .select(`
        id, lender_id, program_name, loan_type,
        min_credit_score, max_ltv, min_dscr, dscr_required,
        min_loan_amount, max_loan_amount,
        allows_foreign_nationals, allows_first_time_investors,
        is_active, notes,
        lenders ( name )
      `)
      .eq("is_active", true);

    const evaluated = (programs || []).map((program) => {
      const lenderName = (program.lenders as { name: string } | null)?.name ?? "Unknown Lender";
      const result = evaluateProgram(loan_package, program as LenderProgram);
      return {
        program_id: program.id,
        lender_name: lenderName,
        program_name: program.program_name,
        fit_category: result.fit_category,
        match_score: result.match_score,
        eligible: result.eligible,
        blocking_reasons: result.blocking_reasons,
        passing_criteria: result.passing_criteria,
        near_misses: result.near_misses,
        salvage_suggestions: result.salvage_suggestions,
        indicative_rate: null as number | null,
        explanation: result.eligible
          ? `${lenderName} — ${program.program_name} is eligible`
          : `${lenderName} — ${result.blocking_reasons[0] || 'Does not meet requirements'}`,
      };
    }).sort((a, b) => b.match_score - a.match_score);

    const eligiblePrograms = evaluated.filter(p => p.eligible);
    const closestOptions = evaluated.filter(p => p.fit_category === 'closest_option');
    const bestProgram = eligiblePrograms[0] ?? closestOptions[0] ?? null;

    const hasEligible = eligiblePrograms.length > 0;
    const hasClosestOptions = closestOptions.length > 0;
    const hasViablePath = hasEligible || hasClosestOptions;

    const eligibleLenderNames = eligiblePrograms.map(p => p.lender_name);

    const verifiedLiquidity = loan_package.financial_metrics.total_available_cash;
    const requiredLiquidity = loan_package.underwriting_metrics.required_liquidity;
    const passesLiquidity = verifiedLiquidity >= requiredLiquidity;

    const requestedAmount = loan_package.loan_terms.requested_amount;
    const qualMin = hasViablePath ? Math.round(requestedAmount * 0.9) : null;
    const qualMax = hasViablePath ? Math.round(requestedAmount * 1.1) : null;
    const recommendedAmount = hasViablePath ? requestedAmount : null;

    const conditions = buildConditions(loan_package, hasEligible, hasClosestOptions, eligibleLenderNames);

    let subStatus: string;
    let machineDecision: string;

    if (hasEligible && passesLiquidity) {
      subStatus = "pre_approved";
      machineDecision = "pre_approved";
    } else if (hasClosestOptions && passesLiquidity) {
      subStatus = "conditional_pre_approved";
      machineDecision = "conditional_pre_approved";
    } else if (!passesLiquidity) {
      subStatus = "liquidity_review_required";
      machineDecision = "pending_review";
    } else {
      subStatus = "manual_review_required";
      machineDecision = "pending_review";
    }

    const machineConfidence = hasEligible
      ? Math.min(0.95, 0.6 + eligiblePrograms.length * 0.05)
      : hasClosestOptions
        ? Math.min(0.7, 0.4 + closestOptions.length * 0.05)
        : 0.2;

    const letterNumber = hasViablePath && passesLiquidity ? generateLetterNumber() : null;

    const { data: submissionData } = await supabase
      .from("intake_submissions")
      .select("user_id")
      .eq("id", submission_id)
      .maybeSingle();

    const userId = submissionData?.user_id || null;

    const preApproval = {
      status: "pending_review",
      sub_status: subStatus,
      requested_loan_amount: requestedAmount,
      verified_liquidity: verifiedLiquidity,
      required_liquidity: requiredLiquidity,
      passes_liquidity_check: passesLiquidity,
      qualification_min: qualMin,
      qualification_max: qualMax,
      recommended_amount: recommendedAmount,
      conditions,
      placerbot_conditions: [],
      matched_programs: evaluated,
      best_program: bestProgram,
      indicative_rate_range: null,
      machine_decision: machineDecision,
      machine_confidence: machineConfidence,
      letter_number: letterNumber,
      has_qualifying_lender: hasEligible,
      has_viable_path: hasViablePath,
      eligible_lender_path: eligibleLenderNames.length > 0
        ? `${loan_package.loan_terms.loan_type.toUpperCase()} programs via ${eligibleLenderNames.slice(0, 3).join(', ')}`
        : hasClosestOptions
          ? `${loan_package.loan_terms.loan_type.toUpperCase()} programs with minor structuring adjustments`
          : null,
    };

    if (hasViablePath && passesLiquidity) {
      await supabase.from("pre_approvals").insert({
        intake_submission_id: submission_id,
        user_id: userId,
        status: "pending_review",
        recommended_amount: recommendedAmount,
        qualification_min: qualMin,
        qualification_max: qualMax,
        passes_liquidity_check: passesLiquidity,
        matched_programs: evaluated,
        requested_loan_amount: requestedAmount,
        verified_liquidity: verifiedLiquidity,
        required_liquidity: requiredLiquidity,
        borrower_type: loan_package.borrower_profile.borrower_type,
        loan_type: loan_package.loan_terms.loan_type,
        estimated_purchase_price: loan_package.loan_terms.purchase_price,
        property_state: loan_package.property_details.address_state,
        conditions: conditions,
        letter_number: letterNumber,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ pre_approval: preApproval }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("run-preapproval error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
