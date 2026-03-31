/*
  # Fix uploaded_documents trigger functions - SECURITY DEFINER

  1. Problem
    - Three INSERT triggers on `uploaded_documents` perform operations on other
      RLS-protected tables (intake_submissions, organization_members, user_accounts,
      notifications, document_processing_jobs)
    - Trigger functions run as the calling user, so nested RLS on these tables
      blocks the trigger operations, causing the entire INSERT to fail
    - This is why document upload registration fails with a DB error

  2. Solution
    - Recreate all three trigger functions with SECURITY DEFINER
    - This allows triggers to bypass RLS when performing their internal operations
    - The triggers are only fired by legitimate inserts that already pass RLS on
      uploaded_documents itself, so this is safe

  3. Affected Functions
    - `create_processing_job_on_upload` - inserts into document_processing_jobs
    - `fn_auto_advance_stage_on_document` - updates intake_submissions
    - `notify_documents_uploaded` - reads intake_submissions, organization_members,
      user_accounts and inserts into notifications
*/

CREATE OR REPLACE FUNCTION create_processing_job_on_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO document_processing_jobs (
    document_id,
    intake_submission_id,
    document_type,
    status,
    priority
  ) VALUES (
    NEW.id,
    NEW.intake_submission_id,
    NEW.document_type,
    'queued'::job_status,
    CASE
      WHEN NEW.document_type IN ('bank_statement', 'rent_roll') THEN 'high'::job_priority
      ELSE 'normal'::job_priority
    END
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_auto_advance_stage_on_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE intake_submissions
  SET processing_stage = 'documents_uploaded',
      updated_at = now()
  WHERE id = NEW.intake_submission_id
    AND processing_stage IN ('documents_uploading', 'intake_received');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_documents_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  submission_record RECORD;
  manager_record RECORD;
BEGIN
  SELECT organization_id, user_id INTO submission_record
  FROM intake_submissions
  WHERE id = NEW.intake_submission_id;

  IF submission_record.organization_id IS NOT NULL THEN
    FOR manager_record IN
      SELECT ua.auth_user_id
      FROM organization_members om
      JOIN user_accounts ua ON ua.id = om.user_account_id
      WHERE om.organization_id = submission_record.organization_id
        AND ua.user_role IN ('admin', 'broker')
    LOOP
      INSERT INTO notifications (user_id, organization_id, event_type, title, message, priority, channel, data)
      VALUES (
        manager_record.auth_user_id,
        submission_record.organization_id,
        'documents_uploaded',
        'Document Uploaded',
        'A new document "' || COALESCE(NEW.file_name, 'file') || '" has been uploaded.',
        'normal',
        'dashboard',
        jsonb_build_object('submission_id', NEW.intake_submission_id, 'document_id', NEW.id)
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
