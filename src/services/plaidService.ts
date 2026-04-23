import { supabase } from './supabaseClient';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

async function callPlaidFunction(action: string, params: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_URL}/plaid-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Plaid request failed');
  return data;
}

export async function createLinkToken(): Promise<string> {
  const data = await callPlaidFunction('create_link_token');
  return data.link_token;
}

export async function notifyLinkSuccess(): Promise<void> {
  await callPlaidFunction('link_success');
}

export async function getReportStatus(): Promise<'pending' | 'ready' | 'error' | null> {
  const data = await callPlaidFunction('get_report_status');
  return data.status;
}
