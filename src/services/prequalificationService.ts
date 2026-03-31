import { supabase } from './supabaseClient';
import type { PrequalResult, BorrowerFinancialProfile } from '../shared/types';

export interface PrequalInput {
  borrowerId: string;
  creditScore: number | null;
  liquidity: number;
  avgMonthlyDeposits: number;
  incomeEstimate: number;
}

export async function runBorrowerPrequalification(borrowerId: string): Promise<PrequalResult | null> {
  const { data: borrower } = await supabase
    .from('borrowers')
    .select('credit_score')
    .eq('id', borrowerId)
    .maybeSingle();

  const { data: financialProfile } = await supabase
    .from('borrower_financial_profiles')
    .select('*')
    .eq('borrower_id', borrowerId)
    .maybeSingle();

  if (!financialProfile && !borrower) {
    return null;
  }

  const creditScore = borrower?.credit_score || 680;
  const liquidity = financialProfile?.liquidity_estimate || 0;
  const avgMonthlyDeposits = financialProfile?.avg_monthly_deposits || 0;
  const incomeEstimate = financialProfile?.income_estimate || avgMonthlyDeposits * 12;

  const baseMultiplier = creditScore >= 740 ? 5 : creditScore >= 700 ? 4.5 : creditScore >= 660 ? 4 : 3.5;
  const prequalifiedAmount = Math.max(incomeEstimate * baseMultiplier, liquidity * 3);

  const qualificationRangeLow = prequalifiedAmount * 0.85;
  const qualificationRangeHigh = prequalifiedAmount * 1.15;

  const baseRate = 0.07;
  const creditAdjustment = (creditScore - 720) * -0.0002;
  const estimatedRateLow = Math.max(0.055, baseRate + creditAdjustment - 0.005);
  const estimatedRateHigh = estimatedRateLow + 0.015;

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (financialProfile?.confidence_score) {
    if (financialProfile.confidence_score >= 80) confidence = 'high';
    else if (financialProfile.confidence_score >= 50) confidence = 'medium';
    else confidence = 'low';
  }

  const summary = `Based on your financial profile with a credit score of ${creditScore} and estimated income of $${incomeEstimate.toLocaleString()}, you may qualify for loan amounts up to $${Math.round(prequalifiedAmount).toLocaleString()}.`;

  const { data: existing } = await supabase
    .from('prequal_results')
    .select('id')
    .eq('borrower_id', borrowerId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prequalData = {
    borrower_id: borrowerId,
    prequalified_amount: Math.round(prequalifiedAmount),
    qualification_range_low: Math.round(qualificationRangeLow),
    qualification_range_high: Math.round(qualificationRangeHigh),
    estimated_rate_low: estimatedRateLow,
    estimated_rate_high: estimatedRateHigh,
    confidence,
    summary,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let result: PrequalResult | null = null;

  if (existing) {
    const { data } = await supabase
      .from('prequal_results')
      .update(prequalData)
      .eq('id', existing.id)
      .select()
      .single();
    result = data;
  } else {
    const { data } = await supabase
      .from('prequal_results')
      .insert(prequalData)
      .select()
      .single();
    result = data;
  }

  await supabase
    .from('borrowers')
    .update({ borrower_status: 'prequalified' })
    .eq('id', borrowerId);

  return result;
}

export async function getPrequalResult(borrowerId: string): Promise<PrequalResult | null> {
  const { data } = await supabase
    .from('prequal_results')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function updateFinancialProfile(
  borrowerId: string,
  profile: Partial<BorrowerFinancialProfile>
): Promise<BorrowerFinancialProfile | null> {
  const { data: existing } = await supabase
    .from('borrower_financial_profiles')
    .select('id')
    .eq('borrower_id', borrowerId)
    .maybeSingle();

  const profileData = {
    ...profile,
    borrower_id: borrowerId,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    const { data } = await supabase
      .from('borrower_financial_profiles')
      .update(profileData)
      .eq('id', existing.id)
      .select()
      .single();
    return data;
  } else {
    const { data } = await supabase
      .from('borrower_financial_profiles')
      .insert(profileData)
      .select()
      .single();
    return data;
  }
}
