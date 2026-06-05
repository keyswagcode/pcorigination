import { supabase } from './supabaseClient';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

async function callPullCreditFunction(action: string, params: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_URL}/pull-credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Credit request failed');
  return data;
}

// ----- Credentials -----

export async function saveIscCredentials(username: string, password: string): Promise<void> {
  await callPullCreditFunction('save_credentials', { username, password });
}

export async function clearIscCredentials(): Promise<void> {
  await callPullCreditFunction('clear_credentials');
}

// ----- Credit pull (two-phase: start → poll) -----

export interface CardPaymentInput {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
  zip: string;
  name?: string;
}

export interface CreditPullStart {
  ok: boolean;
  runId: string;
  liveViewUrl: string | null;
}

export interface CreditPullStatus {
  ok: boolean;
  status: 'pending' | 'succeeded' | 'failed';
  liveViewUrl?: string | null;
  mfaRequired?: boolean;
  error?: string;
  equifax?: number | null;
  experian?: number | null;
  transunion?: number | null;
  mid_score?: number | null;
  monthly_debt?: number | null;
  dti?: number | null;
  document_id?: string | null;
}

export async function submitMfaCode(runId: string, code: string): Promise<void> {
  await callPullCreditFunction('submit_mfa_code', { runId, code });
}

export async function startCreditPull(borrowerId: string, card: CardPaymentInput): Promise<CreditPullStart> {
  return callPullCreditFunction('pull_start', { borrower_id: borrowerId, card });
}

export async function pollCreditPull(runId: string, borrowerId: string): Promise<CreditPullStatus> {
  return callPullCreditFunction('pull_status', { runId, borrower_id: borrowerId });
}

// ----- Saved card metadata (last4 + non-sensitive bits, never the full PAN) -----

export interface SaveCardMetadataInput {
  last4: string;
  brand: string;
  holderName?: string;
  zip?: string;
  expMonth?: string;
  expYear?: string;
}

export async function saveCardMetadata(input: SaveCardMetadataInput): Promise<void> {
  await callPullCreditFunction('save_card_metadata', input as unknown as Record<string, unknown>);
}

export async function forgetSavedCard(): Promise<void> {
  await callPullCreditFunction('forget_card');
}
