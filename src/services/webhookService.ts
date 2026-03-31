import { supabase } from './supabaseClient';

export type WebhookEventType =
  | 'new_borrower'
  | 'doc_upload'
  | 'liquidity_verified'
  | 'pre_approval'
  | 'loan_submitted'
  | 'loan_approved'
  | 'loan_declined';

export interface WebhookBorrower {
  id: string;
  name: string;
  email: string;
}

export interface WebhookPayload {
  event_type: WebhookEventType;
  timestamp: string;
  borrower: WebhookBorrower;
  data: Record<string, unknown>;
}

/**
 * Fetches the Zapier webhook URL for the organization that the given user belongs to.
 */
async function getWebhookUrlForUser(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('organization_members')
    .select('organization_id, organizations (id, zapier_webhook_url)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return null;

  const org = data.organizations as unknown as { id: string; zapier_webhook_url: string | null } | null;
  return org?.zapier_webhook_url ?? null;
}

/**
 * Fire a webhook to the organization's configured Zapier URL.
 * This is fire-and-forget — it does not block on the response and silently
 * swallows errors so it never disrupts the calling workflow.
 */
export function fireWebhook(
  userId: string,
  eventType: WebhookEventType,
  borrower: WebhookBorrower,
  data: Record<string, unknown> = {}
): void {
  const payload: WebhookPayload = {
    event_type: eventType,
    timestamp: new Date().toISOString(),
    borrower,
    data,
  };

  // Fire-and-forget: resolve the webhook URL then POST; never throw.
  getWebhookUrlForUser(userId)
    .then((url) => {
      if (!url) return;

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Silently ignore delivery failures — webhook is best-effort.
      });
    })
    .catch(() => {
      // Silently ignore lookup failures.
    });
}
