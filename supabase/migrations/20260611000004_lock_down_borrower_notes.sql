/*
  # Lock borrower_notes down to managers (close cross-broker leak)

  Live testing showed a broker could read ANOTHER broker's borrower notes via
  a legacy permissive policy that predates this repo's migrations. Notes are
  internal (only BrokerBorrowerDetailPage uses them — borrowers never see
  them), so the only correct audience is "people who manage the borrower":
  the owning broker, staff, and org owner/admins.

  Drop every existing policy on the table and recreate exactly one:
  manager-only, via fn_caller_manages_borrower (from 20260611000003).
*/

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'borrower_notes'
  LOOP
    EXECUTE format('DROP POLICY %I ON borrower_notes', p.policyname);
  END LOOP;
END $$;

ALTER TABLE borrower_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage borrower_notes"
  ON borrower_notes FOR ALL
  TO authenticated
  USING (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id))
  WITH CHECK (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id));

NOTIFY pgrst, 'reload schema';
