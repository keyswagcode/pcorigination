import { supabase } from './supabaseClient';

export interface ActivityLogEntry {
  id: string;
  borrower_id: string;
  user_id: string;
  event_type: string;
  title: string;
  details: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Log an activity event to the borrower_activity_log table.
 */
export async function logActivity(
  borrowerId: string,
  userId: string,
  eventType: string,
  title: string,
  details?: string,
  metadata?: Record<string, unknown>
): Promise<ActivityLogEntry | null> {
  const { data, error } = await supabase
    .from('borrower_activity_log')
    .insert({
      borrower_id: borrowerId,
      user_id: userId,
      event_type: eventType,
      title,
      details: details ?? null,
      metadata: metadata ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to log activity:', error.message);
    return null;
  }

  return data as ActivityLogEntry;
}

/**
 * Fetch all activity log entries for a borrower, ordered newest-first.
 */
export async function getActivityLog(borrowerId: string): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('borrower_activity_log')
    .select('*')
    .eq('borrower_id', borrowerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch activity log:', error.message);
    return [];
  }

  return (data ?? []) as ActivityLogEntry[];
}
