import { supabase } from './supabaseClient';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

async function callSyncGhl(action: string, borrowerId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Not authenticated' };

  try {
    const res = await fetch(`${FUNCTIONS_URL}/sync-ghl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, borrower_id: borrowerId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'GHL sync failed' };
  }
}

export function syncBorrowerToGhl(borrowerId: string) {
  // Best-effort, fire-and-forget. CRM lag should never block the borrower flow.
  return callSyncGhl('borrower_filled_app', borrowerId);
}
