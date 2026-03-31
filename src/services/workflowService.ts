import { supabase } from './supabaseClient';
import type { Notification } from '../shared/types';

export async function fetchNotifications(
  userId: string,
  limit = 20
): Promise<Notification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data as Notification[]) || [];
}

export async function fetchUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  return count || 0;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);
}

export function subscribeToNotifications(
  userId: string,
  onNew: (notification: Notification) => void
) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onNew(payload.new as Notification);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function createNotification(
  userId: string,
  organizationId: string | null,
  eventType: string,
  title: string,
  message: string,
  options?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    actionUrl?: string;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from('notifications').insert({
    user_id: userId,
    organization_id: organizationId,
    event_type: eventType,
    title,
    message,
    priority: options?.priority || 'normal',
    action_url: options?.actionUrl || null,
    data: options?.data || null,
    is_read: false,
    channel: 'in_app',
  });
}
