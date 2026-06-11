import { supabase } from './supabase';

// Best-effort error logging. NEVER throws and never blocks the caller — the
// whole point is to make failures that were being swallowed (.catch(warn),
// generic "An error occurred") visible in app_error_log for staff, without
// changing behavior. Use alongside, not instead of, user-facing handling.
export function logError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    const message =
      err instanceof Error ? err.message
      : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message)
      : typeof err === 'string' ? err
      : null;

    const detail: Record<string, unknown> = { ...(extra || {}) };
    if (err && typeof err === 'object') {
      const e = err as { code?: unknown; details?: unknown; hint?: unknown };
      if (e.code != null) detail.code = e.code;
      if (e.details != null) detail.details = e.details;
      if (e.hint != null) detail.hint = e.hint;
    }

    // Fire-and-forget; swallow any failure of the logger itself.
    void supabase.from('app_error_log').insert({
      context,
      message,
      detail: Object.keys(detail).length ? detail : null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    }).then(({ error }) => {
      if (error) console.warn('[errorLog] failed to record error:', error.message);
    });

    console.error(`[${context}]`, err, extra ?? '');
  } catch {
    /* never let logging break the app */
  }
}
