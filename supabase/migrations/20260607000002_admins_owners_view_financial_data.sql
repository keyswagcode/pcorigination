/*
  # Admins (and owning brokers) can view borrower financial data

  ## Problem
  Admins could not see a borrower's verified liquidity, income, DTI, etc. unless
  they personally owned the borrower. `verified_liquidity` lives in `pre_approvals`
  and income/DTI/liquidity_estimate live in `borrower_financial_profiles`, but
  neither table had RLS read policies covering:
    - the borrower's owning broker (borrowers.broker_id = auth.uid())
    - org-level admins/owners (organization_members), nor
    - in the case of pre_approvals, any staff at all.

  Requirement: an admin should have the SAME view/permissions as the borrower's
  owner — i.e. see everything, regardless of who owns the borrower.

  ## Approach
  A single SECURITY DEFINER helper, fn_caller_can_view_borrower(borrower_id),
  centralizes the access rule. It runs as definer so it can read borrowers /
  user_accounts / organization_members without tripping their own RLS or causing
  recursion when called from a policy. A caller may view a borrower's financials
  when they are ANY of:
    1. the borrower themselves (borrowers.user_id = auth.uid())
    2. the owning broker (borrowers.broker_id = auth.uid())
    3. a system admin or reviewer (user_accounts.user_role IN ('admin','reviewer'))
    4. an org owner/admin over the borrower's broker, OR over the borrower's org

  New PERMISSIVE SELECT policies on both tables call this helper. Permissive
  policies are OR-combined with any existing policies, so this only GRANTS access
  — it cannot remove access anyone already has (e.g. a borrower seeing their own).
*/

CREATE OR REPLACE FUNCTION fn_caller_can_view_borrower(p_borrower_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM borrowers b
    WHERE b.id = p_borrower_id
      AND (
        -- 1. the borrower themselves
        b.user_id = auth.uid()

        -- 2. the owning broker
        OR b.broker_id = auth.uid()

        -- 3. system admin / reviewer
        OR EXISTS (
          SELECT 1 FROM user_accounts ua
          WHERE ua.id = auth.uid()
            AND ua.user_role IN ('admin', 'reviewer')
        )

        -- 4a. org owner/admin over the borrower's broker
        OR (b.broker_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM organization_members om_target
          JOIN organization_members om_caller
            ON om_caller.organization_id = om_target.organization_id
           AND om_caller.is_active = true
          WHERE om_target.user_id = b.broker_id
            AND om_target.is_active = true
            AND om_caller.user_id = auth.uid()
            AND om_caller.role IN ('owner', 'admin')
        ))

        -- 4b. org owner/admin over the borrower's organization
        OR (b.organization_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members om_caller
          WHERE om_caller.organization_id = b.organization_id
            AND om_caller.user_id = auth.uid()
            AND om_caller.is_active = true
            AND om_caller.role IN ('owner', 'admin')
        ))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION fn_caller_can_view_borrower(uuid) TO authenticated;

-- Ensure RLS is on (no-op if already enabled).
ALTER TABLE pre_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrower_financial_profiles ENABLE ROW LEVEL SECURITY;

-- pre_approvals: verified_liquidity, prequalified amounts, etc.
DROP POLICY IF EXISTS "Staff and owners can view pre-approvals" ON pre_approvals;
CREATE POLICY "Staff and owners can view pre-approvals"
  ON pre_approvals FOR SELECT
  TO authenticated
  USING (fn_caller_can_view_borrower(borrower_id));

-- borrower_financial_profiles: income, DTI, liquidity_estimate, etc.
DROP POLICY IF EXISTS "Staff and owners can view financial profiles" ON borrower_financial_profiles;
CREATE POLICY "Staff and owners can view financial profiles"
  ON borrower_financial_profiles FOR SELECT
  TO authenticated
  USING (fn_caller_can_view_borrower(borrower_id));

NOTIFY pgrst, 'reload schema';
