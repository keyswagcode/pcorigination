/*
  # Owning brokers get the full view + management of their borrowers

  ## Problem (verified live against prod with a test broker)
  The owning broker could read most of a borrower's file but hit three gaps:
  - pre_approvals: DELETE was allowed but INSERT returned 403 — the broker
    "manual pre-approve" flow deletes the old rows then inserts new ones, so
    it would destroy the existing pre-approvals and fail to write replacements.
  - borrower_previous_addresses: rows invisible to the owning broker.
  - intake_submissions: the borrower's submissions invisible to the owning broker.

  ## Fix
  fn_caller_manages_borrower(borrower_id): true for the OWNING BROKER
  (borrowers.broker_id = auth.uid()), system staff (user_role admin/reviewer),
  or an org owner/admin over the borrower's broker or org. Deliberately does
  NOT include the borrower themselves — being able to view your own file must
  not imply being able to write pre-approvals for yourself.

  Permissive "Managers can manage <table>" FOR ALL policies on every
  borrower-workflow table (loop guarded by to_regclass), so the owning broker
  has the same read/write surface as staff. Existing policies are untouched
  (permissive = OR-combined). Also: manager read on the document storage
  buckets keyed by the path's borrower user-id segment, so file downloads keep
  working for brokers when the bucket-wide read is tightened later.
*/

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
        -- owning broker
        b.broker_id = auth.uid()

        -- system staff
        OR EXISTS (
          SELECT 1 FROM user_accounts ua
          WHERE ua.id = auth.uid()
            AND ua.user_role IN ('admin', 'reviewer')
        )

        -- org owner/admin over the borrower's broker
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

        -- org owner/admin over the borrower's organization
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

GRANT EXECUTE ON FUNCTION fn_caller_manages_borrower(uuid) TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'pre_approvals',
    'intake_submissions',
    'borrower_previous_addresses',
    'uploaded_documents',
    'bank_statement_accounts',
    'co_borrowers',
    'borrower_notes',
    'borrower_activity_log',
    'borrower_financial_profiles',
    'loan_scenarios'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Table % does not exist — skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Managers can manage %s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "Managers can manage %s" ON %I FOR ALL TO authenticated
         USING (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id))
         WITH CHECK (borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id))',
      t, t
    );
  END LOOP;
END $$;

-- document_processing_jobs has no borrower_id; route through its submission.
DROP POLICY IF EXISTS "Managers can manage document_processing_jobs" ON document_processing_jobs;
CREATE POLICY "Managers can manage document_processing_jobs"
  ON document_processing_jobs FOR ALL
  TO authenticated
  USING (
    intake_submission_id IN (
      SELECT id FROM intake_submissions
      WHERE borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id)
    )
  )
  WITH CHECK (
    intake_submission_id IN (
      SELECT id FROM intake_submissions
      WHERE borrower_id IS NOT NULL AND fn_caller_manages_borrower(borrower_id)
    )
  );

-- Storage: managers can download their borrowers' files. Paths are
-- borrowers/{auth_user_id}/... — segment 2 maps to borrowers.user_id.
DROP POLICY IF EXISTS "Managers can read managed borrower files" ON storage.objects;
CREATE POLICY "Managers can read managed borrower files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('documents', 'borrower-documents')
    AND EXISTS (
      SELECT 1 FROM borrowers b
      WHERE b.user_id::text = (storage.foldername(name))[2]
        AND fn_caller_manages_borrower(b.id)
    )
  );

NOTIFY pgrst, 'reload schema';
