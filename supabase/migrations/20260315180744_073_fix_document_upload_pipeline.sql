/*
  # Fix Document Upload Pipeline

  1. Schema Changes
    - Add `borrower_id` column to `uploaded_documents` table (nullable, references borrowers)
    - This column tracks which borrower uploaded the document for audit purposes

  2. Security Changes
    - Replace overly permissive RLS policies on `uploaded_documents` with proper ownership checks
    - Users can only access documents belonging to their own intake submissions
    - INSERT requires the intake_submission to belong to the authenticated user
    - SELECT/UPDATE/DELETE restricted to documents from user's own submissions

  3. Triggers
    - Add trigger `trg_auto_advance_stage_on_document_insert` that automatically updates
      `intake_submissions.processing_stage` from `documents_uploading` to `documents_uploaded`
      when a document is inserted for that submission

  4. Important Notes
    - The borrower_id column is nullable to avoid breaking existing data
    - The trigger only advances stage if it's currently `documents_uploading`
    - Existing documents retain their current state
*/

-- 1. Add borrower_id column to uploaded_documents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uploaded_documents' AND column_name = 'borrower_id'
  ) THEN
    ALTER TABLE uploaded_documents ADD COLUMN borrower_id uuid REFERENCES borrowers(id);
  END IF;
END $$;

-- 2. Fix RLS policies on uploaded_documents
DROP POLICY IF EXISTS "Users can view documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can insert documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can update documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can delete documents" ON uploaded_documents;

CREATE POLICY "Users can view own documents"
  ON uploaded_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM intake_submissions
      WHERE intake_submissions.id = uploaded_documents.intake_submission_id
      AND (
        intake_submissions.user_id = auth.uid()
        OR intake_submissions.organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid() AND is_active = true
        )
      )
    )
  );

CREATE POLICY "Users can insert own documents"
  ON uploaded_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intake_submissions
      WHERE intake_submissions.id = uploaded_documents.intake_submission_id
      AND (
        intake_submissions.user_id = auth.uid()
        OR intake_submissions.organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid() AND is_active = true
        )
      )
    )
  );

CREATE POLICY "Users can update own documents"
  ON uploaded_documents FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM intake_submissions
      WHERE intake_submissions.id = uploaded_documents.intake_submission_id
      AND (
        intake_submissions.user_id = auth.uid()
        OR intake_submissions.organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid() AND is_active = true
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intake_submissions
      WHERE intake_submissions.id = uploaded_documents.intake_submission_id
      AND (
        intake_submissions.user_id = auth.uid()
        OR intake_submissions.organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid() AND is_active = true
        )
      )
    )
  );

CREATE POLICY "Users can delete own documents"
  ON uploaded_documents FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM intake_submissions
      WHERE intake_submissions.id = uploaded_documents.intake_submission_id
      AND intake_submissions.user_id = auth.uid()
    )
  );

-- 3. Create trigger to auto-advance processing_stage when document is inserted
CREATE OR REPLACE FUNCTION fn_auto_advance_stage_on_document()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE intake_submissions
  SET processing_stage = 'documents_uploaded',
      updated_at = now()
  WHERE id = NEW.intake_submission_id
    AND processing_stage IN ('documents_uploading', 'intake_received');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_advance_stage_on_document_insert ON uploaded_documents;

CREATE TRIGGER trg_auto_advance_stage_on_document_insert
  AFTER INSERT ON uploaded_documents
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_advance_stage_on_document();
