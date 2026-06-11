/*
  # System admins/reviewers get the full owner-equivalent view of all borrowers

  ## Problem
  Admins reported they still can't see parts of borrower files. The earlier fix
  (20260607000002) covered pre_approvals and borrower_financial_profiles, but
  many supporting tables only grant access via org membership or the borrower
  themselves — e.g. uploaded_documents, normalized_bank_accounts,
  extraction_audit_log, document_classifications — and several have no staff
  policy at all (co_borrowers, borrower_notes, borrower_activity_log,
  borrower_previous_addresses, intake_submissions). Storage downloads of the
  actual statement/document files were similarly restricted to the uploader.

  ## Fix
  - fn_caller_is_staff(): true when user_accounts.user_role IN ('admin','reviewer').
  - A permissive "Staff can manage <table>" FOR ALL policy on every
    borrower-data table, applied via a loop guarded by to_regclass so missing
    tables are skipped instead of erroring. FOR ALL gives admins the same
    read/write permissions as owners, per requirement. Permissive policies are
    OR-combined: existing access is untouched.
  - Staff SELECT on storage.objects for the document buckets so admins can
    download the underlying files.
*/

CREATE OR REPLACE FUNCTION fn_caller_is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_accounts
    WHERE id = auth.uid() AND user_role IN ('admin', 'reviewer')
  );
$$;

GRANT EXECUTE ON FUNCTION fn_caller_is_staff() TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'borrowers',
    'pre_approvals',
    'borrower_financial_profiles',
    'uploaded_documents',
    'intake_submissions',
    'normalized_bank_accounts',
    'extraction_audit_log',
    'document_classifications',
    'co_borrowers',
    'borrower_notes',
    'borrower_activity_log',
    'borrower_previous_addresses',
    'bank_statement_accounts',
    'document_processing_jobs',
    'loan_scenarios',
    'prequal_results',
    'borrower_identity_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Table % does not exist — skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff can manage %s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "Staff can manage %s" ON %I FOR ALL TO authenticated
         USING (fn_caller_is_staff())
         WITH CHECK (fn_caller_is_staff())',
      t, t
    );
  END LOOP;
END $$;

-- Storage: staff can download borrower document files.
DROP POLICY IF EXISTS "Staff can read borrower document files" ON storage.objects;
CREATE POLICY "Staff can read borrower document files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('documents', 'borrower-documents')
    AND fn_caller_is_staff()
  );

NOTIFY pgrst, 'reload schema';
