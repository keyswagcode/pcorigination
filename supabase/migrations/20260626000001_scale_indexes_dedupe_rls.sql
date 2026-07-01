/*
  # Scale pass: dedupe pre-approvals, missing indexes, retention, hot-path RLS

  From the codebase scalability review:

  1. pre_approvals duplicates — the client poll (5s), the Plaid webhook, and the
     15-min sweep can all process the same borrower concurrently; each does
     delete-then-insert of 3 rows with no constraint, so prod has 33 duplicate
     (borrower_id, loan_type) pairs (some x6). Dedupe keeping the newest row and
     add a UNIQUE index so it can never recur (writers move to upsert).

  2. Missing indexes on hot predicates (borrowers.broker_id, plaid_report_status,
     documents/submissions FKs, organization_members — the latter is CRITICAL
     because every RLS policy joins it). The 17 legacy tables have no DDL in git,
     so all indexes are created IF NOT EXISTS.

  3. app_error_log retention (90 days) via pg_cron, same pattern as the other
     crons, so the log can't grow unbounded.

  4. RLS hot path: "Managers can view/update borrowers" called the SECURITY
     DEFINER helper PER ROW (N function calls, each with 3-4 subqueries, on
     every borrower list). Inline the same logic as plain EXISTS clauses the
     planner can optimize. Semantics identical to fn_caller_manages_borrower.
*/

-- ── 1. Dedupe pre_approvals, keep the newest per (borrower_id, loan_type) ──
DELETE FROM pre_approvals p
USING pre_approvals newer
WHERE p.borrower_id = newer.borrower_id
  AND p.loan_type = newer.loan_type
  AND newer.created_at > p.created_at;

-- Tie-breaker for rows sharing identical created_at (same-batch duplicates)
DELETE FROM pre_approvals p
USING pre_approvals keeper
WHERE p.borrower_id = keeper.borrower_id
  AND p.loan_type = keeper.loan_type
  AND p.created_at = keeper.created_at
  AND p.id < keeper.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_approvals_borrower_loan_type
  ON pre_approvals(borrower_id, loan_type);

-- ── 2. Missing performance indexes ──
CREATE INDEX IF NOT EXISTS idx_borrowers_user_id ON borrowers(user_id);
CREATE INDEX IF NOT EXISTS idx_borrowers_broker_id ON borrowers(broker_id);
CREATE INDEX IF NOT EXISTS idx_borrowers_organization_id ON borrowers(organization_id);
CREATE INDEX IF NOT EXISTS idx_borrowers_plaid_report_status ON borrowers(plaid_report_status)
  WHERE plaid_report_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_borrowers_created_at ON borrowers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pre_approvals_borrower_id ON pre_approvals(borrower_id);

CREATE INDEX IF NOT EXISTS idx_uploaded_documents_borrower_id ON uploaded_documents(borrower_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_submission ON uploaded_documents(intake_submission_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_processing_status ON uploaded_documents(processing_status)
  WHERE processing_status IN ('pending', 'processing', 'failed');

CREATE INDEX IF NOT EXISTS idx_intake_submissions_borrower_id ON intake_submissions(borrower_id);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_user_id ON intake_submissions(user_id);

CREATE INDEX IF NOT EXISTS idx_borrower_activity_log_borrower_created
  ON borrower_activity_log(borrower_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loan_scenarios_borrower_id ON loan_scenarios(borrower_id);
CREATE INDEX IF NOT EXISTS idx_loan_scenarios_status ON loan_scenarios(status);

-- CRITICAL: every RLS policy joins organization_members
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by ON organization_members(organization_id, invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_borrower_notes_borrower_id ON borrower_notes(borrower_id);
CREATE INDEX IF NOT EXISTS idx_co_borrowers_borrower_id ON co_borrowers(borrower_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_accounts_borrower ON bank_statement_accounts(borrower_id);

-- ── 3. app_error_log retention: delete rows older than 90 days, nightly ──
DO $$
DECLARE job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'app-error-log-retention';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'app-error-log-retention',
  '30 2 * * *',
  $$ DELETE FROM app_error_log WHERE created_at < now() - interval '90 days' $$
);

-- ── 4. Inline the hot borrowers manager policies (no per-row function call) ──
-- Same access semantics as fn_caller_manages_borrower: owning broker, system
-- staff, org owner/admin (over broker or org), VP over own + invited AEs.

DROP POLICY IF EXISTS "Managers can view borrowers" ON borrowers;
CREATE POLICY "Managers can view borrowers"
  ON borrowers FOR SELECT
  TO authenticated
  USING (
    broker_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid() AND ua.user_role IN ('admin', 'reviewer')
    )
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM organization_members om_target
      JOIN organization_members om_caller
        ON om_caller.organization_id = om_target.organization_id
       AND om_caller.is_active = true
      WHERE om_target.user_id = borrowers.broker_id
        AND om_target.is_active = true
        AND om_caller.user_id = auth.uid()
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members om_caller
      WHERE om_caller.organization_id = borrowers.organization_id
        AND om_caller.user_id = auth.uid()
        AND om_caller.is_active = true
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members vp
      WHERE vp.user_id = auth.uid()
        AND vp.is_active = true
        AND vp.role = 'vp'
        AND (
          borrowers.broker_id = vp.user_id
          OR borrowers.broker_id IN (
            SELECT om.user_id FROM organization_members om
            WHERE om.organization_id = vp.organization_id
              AND om.invited_by_user_id = vp.user_id
          )
        )
    ))
  );

DROP POLICY IF EXISTS "Managers can update borrowers" ON borrowers;
CREATE POLICY "Managers can update borrowers"
  ON borrowers FOR UPDATE
  TO authenticated
  USING (
    broker_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid() AND ua.user_role IN ('admin', 'reviewer')
    )
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM organization_members om_target
      JOIN organization_members om_caller
        ON om_caller.organization_id = om_target.organization_id
       AND om_caller.is_active = true
      WHERE om_target.user_id = borrowers.broker_id
        AND om_target.is_active = true
        AND om_caller.user_id = auth.uid()
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members om_caller
      WHERE om_caller.organization_id = borrowers.organization_id
        AND om_caller.user_id = auth.uid()
        AND om_caller.is_active = true
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members vp
      WHERE vp.user_id = auth.uid()
        AND vp.is_active = true
        AND vp.role = 'vp'
        AND (
          borrowers.broker_id = vp.user_id
          OR borrowers.broker_id IN (
            SELECT om.user_id FROM organization_members om
            WHERE om.organization_id = vp.organization_id
              AND om.invited_by_user_id = vp.user_id
          )
        )
    ))
  )
  WITH CHECK (
    broker_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid() AND ua.user_role IN ('admin', 'reviewer')
    )
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM organization_members om_target
      JOIN organization_members om_caller
        ON om_caller.organization_id = om_target.organization_id
       AND om_caller.is_active = true
      WHERE om_target.user_id = borrowers.broker_id
        AND om_target.is_active = true
        AND om_caller.user_id = auth.uid()
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members om_caller
      WHERE om_caller.organization_id = borrowers.organization_id
        AND om_caller.user_id = auth.uid()
        AND om_caller.is_active = true
        AND om_caller.role IN ('owner', 'admin')
    ))
    OR (broker_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organization_members vp
      WHERE vp.user_id = auth.uid()
        AND vp.is_active = true
        AND vp.role = 'vp'
        AND (
          borrowers.broker_id = vp.user_id
          OR borrowers.broker_id IN (
            SELECT om.user_id FROM organization_members om
            WHERE om.organization_id = vp.organization_id
              AND om.invited_by_user_id = vp.user_id
          )
        )
    ))
  );

ANALYZE borrowers;
ANALYZE pre_approvals;
ANALYZE organization_members;
ANALYZE uploaded_documents;

NOTIFY pgrst, 'reload schema';
