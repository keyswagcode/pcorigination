import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;
const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
}) : null;

export async function sendNewApplicationAlert(params: {
  borrowerName: string;
  borrowerEmail: string;
  brokerId: string;
}) {
  if (!adminClient) return;

  try {
    // Get the broker's info
    const { data: broker } = await adminClient
      .from('user_accounts')
      .select('email, first_name, last_name')
      .eq('id', params.brokerId)
      .maybeSingle();

    // Get the broker's organization
    const { data: orgMember } = await adminClient
      .from('organization_members')
      .select('organization_id, organizations(name, zapier_webhook_url)')
      .eq('user_id', params.brokerId)
      .maybeSingle();

    const org = orgMember?.organizations as { name: string; zapier_webhook_url: string | null } | null;

    // Get all starred team members in this org
    const recipientEmails: string[] = [];

    // Always include the broker/AE who owns this borrower
    if (broker?.email) recipientEmails.push(broker.email);

    // Get starred members
    if (orgMember?.organization_id) {
      const { data: starredMembers } = await adminClient
        .from('organization_members')
        .select('email, user_id')
        .eq('organization_id', orgMember.organization_id)
        .eq('is_active', true)
        .eq('notify_new_apps', true);

      if (starredMembers) {
        for (const member of starredMembers) {
          if (member.email && !recipientEmails.includes(member.email)) {
            recipientEmails.push(member.email);
          }
        }
      }
    }

    // Send email via Supabase Auth (password reset trick to send email)
    // Actually, use a direct approach - send via webhook which can trigger GHL email
    // AND send a notification record for in-app tracking

    // 1. Fire Zapier webhook
    if (org?.zapier_webhook_url) {
      fetch(org.zapier_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'new_borrower',
          timestamp: new Date().toISOString(),
          borrower: {
            name: params.borrowerName,
            email: params.borrowerEmail,
          },
          broker: {
            name: broker ? `${broker.first_name} ${broker.last_name}` : 'Unknown',
            email: broker?.email,
          },
          alert_recipients: recipientEmails,
          organization: org?.name,
        }),
      }).catch(() => {});
    }

    // 2. Create in-app notifications for each recipient
    for (const email of recipientEmails) {
      const { data: recipientUser } = await adminClient
        .from('user_accounts')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (recipientUser) {
        await adminClient.from('notifications').insert({
          user_id: recipientUser.id,
          event_type: 'new_borrower',
          title: 'New Application Received',
          message: `${params.borrowerName} (${params.borrowerEmail}) has submitted a new application.`,
          priority: 'high',
          channel: 'in_app',
          data: {
            borrower_name: params.borrowerName,
            borrower_email: params.borrowerEmail,
            broker_id: params.brokerId,
          },
        });
      }
    }
  } catch (err) {
    console.error('Failed to send new app alert:', err);
  }
}
