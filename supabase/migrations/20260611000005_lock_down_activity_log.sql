/*
  # Lock borrower_activity_log down to managers (close cross-broker leak)

  Same legacy issue as borrower_notes (20260611000004): a permissive policy
  predating this repo let any broker read other brokers' borrower activity.
  Activity rows are only read/written from broker/staff pages
  (BrokerBorrowerDetailPage, BrokerDashboardPage, BrokerLoanReviewPage), so
  restrict to managers of the borrower.
*/

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'borrower_activity_log'
  LOOP
    EXECUTE format('DROP POLICY %I ON borrower_activity_log', p.policyname);
  END LOOP;
END $$;

ALTER TABLE borrower_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage borrower_activity_log"
  ON borrower_activity_log FOR ALL
  TO authenticated
  USING (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id))
  WITH CHECK (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id));

NOTIFY pgrst, 'reload schema';
