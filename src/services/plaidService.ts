import { supabase } from './supabaseClient';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

async function callPlaidFunction(action: string, params: Record<string, unknown> = {}) {
  let { data: { session } } = await supabase.auth.getSession();
  // A borrower can sit on the page long enough for the access token to expire
  // (the recurring "Session from session_id claim in JWT does not exist"
  // failures). Refresh proactively when the token is expired or about to be.
  const expiresAt = (session?.expires_at ?? 0) * 1000;
  if (!session || expiresAt - Date.now() < 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) session = refreshed.session;
  }
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

export async function getReportStatus(): Promise<{ status: 'pending' | 'ready' | 'error' | null; detail?: string }> {
  const data = await callPlaidFunction('get_report_status');
  return { status: data.status, detail: data.detail };
}
