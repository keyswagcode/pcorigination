/*
  # VP hierarchy at the data layer

  AE/VP/Admin visibility was enforced only in the dashboard UI
  (getVisibleBrokerIds). At the RLS layer, org owners/admins were covered but
  a 'vp' org member was not — so a VP querying the API directly saw only their
  own borrowers, not their AEs'. This adds the VP rule (mirroring the UI:
  a VP sees their own borrowers + those of any member they invited) to both
  borrower-access helpers, so every policy built on them extends to VPs.
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
        b.user_id = auth.uid()
        OR b.broker_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_accounts ua
          WHERE ua.id = auth.uid() AND ua.user_role IN ('admin', 'reviewer')
        )
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
        OR (b.organization_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members om_caller
          WHERE om_caller.organization_id = b.organization_id
            AND om_caller.user_id = auth.uid()
            AND om_caller.is_active = true
            AND om_caller.role IN ('owner', 'admin')
        ))
        -- VP: own borrowers + borrowers of brokers the VP invited (same org)
        OR (b.broker_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members vp
          WHERE vp.user_id = auth.uid()
            AND vp.is_active = true
            AND vp.role = 'vp'
            AND (
              b.broker_id = vp.user_id
              OR b.broker_id IN (
                SELECT om.user_id FROM organization_members om
                WHERE om.organization_id = vp.organization_id
                  AND om.invited_by_user_id = vp.user_id
              )
            )
        ))
      )
  );
$$;

CREATE OR REPLACE FUNCTION fn_caller_manages_borrower(p_borrower_id uuid)
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
        b.broker_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_accounts ua
          WHERE ua.id = auth.uid() AND ua.user_role IN ('admin', 'reviewer')
        )
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
        OR (b.organization_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members om_caller
          WHERE om_caller.organization_id = b.organization_id
            AND om_caller.user_id = auth.uid()
            AND om_caller.is_active = true
            AND om_caller.role IN ('owner', 'admin')
        ))
        -- VP: own borrowers + borrowers of brokers the VP invited (same org)
        OR (b.broker_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members vp
          WHERE vp.user_id = auth.uid()
            AND vp.is_active = true
            AND vp.role = 'vp'
            AND (
              b.broker_id = vp.user_id
              OR b.broker_id IN (
                SELECT om.user_id FROM organization_members om
                WHERE om.organization_id = vp.organization_id
                  AND om.invited_by_user_id = vp.user_id
              )
            )
        ))
      )
  );
$$;

NOTIFY pgrst, 'reload schema';
