/*
  # Realtime on borrowers — push Plaid report status instead of polling

  The borrower home page polled get_report_status every 5s while a CRA report
  generated (~60+ calls per borrower, thousands/hour at volume). The webhook
  already flips borrowers.plaid_report_status server-side; broadcasting that
  row change lets the client react instantly and drop to a slow 30s fallback
  poll (which still triggers the server-side direct-fetch recovery).

  postgres_changes respects RLS, so a borrower only receives changes for rows
  they can SELECT (their own borrower row).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'borrowers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE borrowers;
  END IF;
END $$;

-- Realtime needs the old row for UPDATE events under RLS.
ALTER TABLE borrowers REPLICA IDENTITY FULL;
