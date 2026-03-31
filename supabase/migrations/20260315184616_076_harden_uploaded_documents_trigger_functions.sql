/*
  # Harden uploaded_documents trigger functions

  1. Problem
    - SECURITY DEFINER functions do not inherit the caller's search_path
    - Without explicit `SET search_path = public`, unqualified table references
      may resolve incorrectly, causing silent failures
    - The notification trigger can fail on NULL auth_user_id values, blocking uploads
    - Any trigger failure currently cancels the entire document insert

  2. Changes
    - Add `SET search_path = public` to all three trigger functions
    - Add NULL guard (`ua.auth_user_id IS NOT NULL`) in notification query
    - Wrap secondary operations (processing job, stage advance, notifications)
      in EXCEPTION blocks so trigger failures do not block document uploads

  3. Affected Functions
    - `create_processing_job_on_upload`
    - `fn_auto_advance_stage_on_document`
    - `notify_documents_uploaded`
*/

CREATE OR REPLACE FUNCTION create_processing_job_on_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_processing_job_on_upload failed for document %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_auto_advance_stage_on_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE intake_submissions
    SET processing_stage = 'documents_uploaded',
        updated_at = now()
    WHERE id = NEW.intake_submission_id
      AND processing_stage IN ('documents_uploading', 'intake_received');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_auto_advance_stage_on_document failed for submission %: %', NEW.intake_submission_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_documents_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submission_record RECORD;
  manager_record RECORD;
BEGIN
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
          AND ua.auth_user_id IS NOT NULL
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_documents_uploaded failed for document %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
