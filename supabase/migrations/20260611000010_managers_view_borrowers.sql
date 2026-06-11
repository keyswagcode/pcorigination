/*
  # Managers (incl. VPs) can view/update their borrowers' rows

  The borrowers table had policies for the borrower themselves, system staff,
  and org owner/admins — but NOT for the owning broker's manager chain via
  fn_caller_manages_borrower, so a VP could read a managed borrower's financial
  profile yet not the borrower row itself (the dashboard's VP→AE visibility
  was never actually backed at the data layer).

  Add manager SELECT + UPDATE on borrowers via fn_caller_manages_borrower
  (owning broker, staff, org owner/admin, and VP-over-invited-AEs). INSERT/
  DELETE are intentionally left to existing policies — managers view and work
  borrowers, they don't create/delete them here.
*/

ALTER TABLE borrowers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view borrowers" ON borrowers;
CREATE POLICY "Managers can view borrowers"
  ON borrowers FOR SELECT
  TO authenticated
  USING (fn_caller_manages_borrower(id));

DROP POLICY IF EXISTS "Managers can update borrowers" ON borrowers;
CREATE POLICY "Managers can update borrowers"
  ON borrowers FOR UPDATE
  TO authenticated
  USING (fn_caller_manages_borrower(id))
  WITH CHECK (fn_caller_manages_borrower(id));

NOTIFY pgrst, 'reload schema';
