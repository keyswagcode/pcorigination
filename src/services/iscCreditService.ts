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

export async function saveIscCredentials(username: string, password: string): Promise<void> {
  await callPullCreditFunction('save_credentials', { username, password });
}

export async function clearIscCredentials(): Promise<void> {
  await callPullCreditFunction('clear_credentials');
}

export interface CreditPullResponse {
  ok: boolean;
  equifax: number | null;
  experian: number | null;
  transunion: number | null;
  mid_score: number | null;
}

export async function pullCreditForBorrower(borrowerId: string): Promise<CreditPullResponse> {
  return callPullCreditFunction('pull', { borrower_id: borrowerId });
}
