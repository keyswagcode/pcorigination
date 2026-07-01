/*
  # Lock down document-bucket READS to owners + managers

  Live testing showed ANY authenticated user could download ANY borrower's
  files (bank statements, consent PDFs with SSN last-4) from the private
  borrower-documents bucket via legacy permissive SELECT policies. Writes are
  untouched. Brokers/AEs/admins keep full access via the existing manager and
  staff policies (20260611000002/3).

  Drops every legacy SELECT policy on storage.objects that references the
  document buckets (except our named staff/manager policies), then adds an
  owner policy covering the path conventions in use:
    - borrowers/{auth_user_id}/...        (statement + consent uploads)
    - {auth_user_id}/...                  (older uploads keyed by user id)
    - {borrower_id}/...                   (older consent/credit-report paths)
*/

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'SELECT'
      AND policyname NOT IN (
        'Staff can read borrower document files',
        'Managers can read managed borrower files',
        'Owners can read own document files'
      )
      AND (
        qual ILIKE '%borrower-documents%'
        OR qual ILIKE '%id-documents%'
        OR qual ~* '''documents'''
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
    RAISE NOTICE 'Dropped legacy storage SELECT policy: %', p.policyname;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Owners can read own document files" ON storage.objects;
CREATE POLICY "Owners can read own document files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('documents', 'borrower-documents', 'id-documents')
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM borrowers WHERE user_id = auth.uid()
      )
    )
  );
