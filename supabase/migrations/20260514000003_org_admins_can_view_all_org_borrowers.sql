/*
  # Org admins/owners can read all borrowers (and therefore all loans) in their organization

  Migration 091 fixed loan_scenarios but the dashboard / All Borrowers page
  reads from `borrowers` first. With no admin policy on borrowers, an org
  admin sees an empty list and the downstream loan queries return nothing
  via `.in('borrower_id', [])`.

  We grant SELECT on `borrowers` to any caller who is owner/admin in the
  same organization the borrower belongs to. "Belongs to" means either:
    - the borrower's broker_id (the AE who created/owns them) is a member
      of the caller's org, OR
    - the borrower's organization_id directly matches an org where the
      caller is owner/admin (covers unassigned borrowers).

  We also re-create the loan_scenarios policy from migration 091 to use
  the same broader logic (org-id fallback). Existing policies for the
  borrower themselves and KREC reviewers/admins are left untouched —
  Postgres RLS combines permissive policies with OR.

  All three helpers use SECURITY DEFINER to dodge nested RLS recursion
  against organization_members (same pattern as migration 074's
  fn_user_owns_submission).
*/

CREATE OR REPLACE FUNCTION fn_caller_is_org_admin_for_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om_target
    JOIN organization_members om_caller
      ON om_caller.organization_id = om_target.organization_id
     AND om_caller.is_active = true
    WHERE om_target.user_id = p_user_id
      AND om_target.is_active = true
      AND om_caller.user_id = auth.uid()
      AND om_caller.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION fn_caller_is_org_admin_for_org(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
      AND organization_id = p_organization_id
      AND is_active = true
      AND role IN ('owner', 'admin')
  );
$$;

-- Replaces the version from migration 091 with the broader OR-of-paths logic.
CREATE OR REPLACE FUNCTION fn_user_is_org_admin_for_borrower(p_borrower_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM borrowers b
    WHERE b.id = p_borrower_id
      AND (
        (b.broker_id IS NOT NULL AND fn_caller_is_org_admin_for_user(b.broker_id))
        OR
        (b.organization_id IS NOT NULL AND fn_caller_is_org_admin_for_org(b.organization_id))
      )
  );
$$;

-- Borrowers: org admins / owners see every borrower in their org.
DROP POLICY IF EXISTS "Org admins can view all org borrowers" ON borrowers;
CREATE POLICY "Org admins can view all org borrowers"
  ON borrowers FOR SELECT
  TO authenticated
  USING (
    (broker_id IS NOT NULL AND fn_caller_is_org_admin_for_user(broker_id))
    OR
    (organization_id IS NOT NULL AND fn_caller_is_org_admin_for_org(organization_id))
  );

-- Re-apply the loan_scenarios policy from migration 091, now that the helper
-- function has the broader logic.
DROP POLICY IF EXISTS "Org admins can view all org loan scenarios" ON loan_scenarios;
CREATE POLICY "Org admins can view all org loan scenarios"
  ON loan_scenarios FOR SELECT
  TO authenticated
  USING (fn_user_is_org_admin_for_borrower(borrower_id));
