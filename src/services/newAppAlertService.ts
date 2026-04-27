import { supabase } from './supabaseClient';

export async function sendNewApplicationAlert(params: {
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone?: string | null;
  brokerId: string;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-new-application`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          borrower_name: params.borrowerName,
          borrower_email: params.borrowerEmail,
          borrower_phone: params.borrowerPhone || null,
          broker_id: params.brokerId,
        }),
      }
    );
  } catch (err) {
    console.error('Failed to send new app alert:', err);
  }
}
