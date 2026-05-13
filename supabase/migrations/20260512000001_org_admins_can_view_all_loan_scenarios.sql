/*
  # Org admins/owners can read all loan_scenarios in their organization

  Problem: a broker-org "admin" (e.g. Daisy Mondragon) can't see an AE's
  loan because the only loan_scenarios SELECT policies grant access to
  (a) the borrower themselves and (b) KREC staff with user_accounts.user_role
  IN ('reviewer','admin'). There is no policy granting an org admin/owner
  visibility into their teammates' loans.

  Fix: add a SECURITY DEFINER helper that walks
    auth.uid() -> organization_members(role IN ('owner','admin'))
              -> organization_members(other members in same org)
              -> borrowers.broker_id
              -> loan_scenarios.borrower_id
  and a SELECT policy on loan_scenarios that uses it.

  SECURITY DEFINER avoids nested RLS recursion against organization_members
  (same pattern as fn_user_owns_submission in migration 074).
*/

CREATE OR REPLACE FUNCTION fn_user_is_org_admin_for_borrower(p_borrower_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM borrowers b
    JOIN organization_members om_owner
      ON om_owner.user_id = b.broker_id
     AND om_owner.is_active = true
    JOIN organization_members om_admin
      ON om_admin.organization_id = om_owner.organization_id
     AND om_admin.is_active = true
    WHERE b.id = p_borrower_id
      AND om_admin.user_id = auth.uid()
      AND om_admin.role IN ('owner', 'admin')
  );
$$;

DROP POLICY IF EXISTS "Org admins can view all org loan scenarios" ON loan_scenarios;

CREATE POLICY "Org admins can view all org loan scenarios"
  ON loan_scenarios FOR SELECT
  TO authenticated
  USING (fn_user_is_org_admin_for_borrower(borrower_id));
