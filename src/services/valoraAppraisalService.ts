import { supabase } from './supabaseClient';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

async function call(action: string, params: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_URL}/order-appraisal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Appraisal request failed');
  return data;
}

export async function saveValoraCredentials(username: string, password: string): Promise<void> {
  await call('save_credentials', { username, password });
}

export async function clearValoraCredentials(): Promise<void> {
  await call('clear_credentials');
}

export interface AppraisalClassification {
  productCode: string;
  needsArv: boolean;
  needsSubjectToRepairs: boolean;
}

export async function previewAppraisal(loanId: string): Promise<{ ok: boolean; classification: AppraisalClassification }> {
  return call('preview', { loan_id: loanId });
}

export interface AppraisalOrderResponse {
  ok: boolean;
  order_id: string | null;
  classification: AppraisalClassification;
}

export async function orderAppraisal(loanId: string): Promise<AppraisalOrderResponse> {
  return call('order', { loan_id: loanId });
}
