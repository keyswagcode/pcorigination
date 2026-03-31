/*
  # Fix uploaded_documents RLS nested policy issue

  1. Problem
    - The INSERT policy on `uploaded_documents` uses an EXISTS subquery against
      `intake_submissions`, which itself has RLS enabled
    - This creates a nested RLS check that blocks inserts even for legitimate users
    - The subquery also references `organization_members` which also has RLS

  2. Solution
    - Create a SECURITY DEFINER helper function that checks if a user owns
      an intake submission (bypasses nested RLS)
    - Replace all uploaded_documents policies to use this helper function

  3. Security
    - The helper function runs as the DB owner but only returns a boolean
    - It checks user_id directly OR organization membership
    - All policies still require authenticated role
*/

CREATE OR REPLACE FUNCTION fn_user_owns_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM intake_submissions
    WHERE id = p_submission_id
    AND (
      user_id = auth.uid()
      OR organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND is_active = true
      )
    )
  );
$$;

DROP POLICY IF EXISTS "Users can view own documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON uploaded_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON uploaded_documents;

CREATE POLICY "Users can view own documents"
  ON uploaded_documents FOR SELECT
  TO authenticated
  USING (fn_user_owns_submission(intake_submission_id));

CREATE POLICY "Users can insert own documents"
  ON uploaded_documents FOR INSERT
  TO authenticated
  WITH CHECK (fn_user_owns_submission(intake_submission_id));

CREATE POLICY "Users can update own documents"
  ON uploaded_documents FOR UPDATE
  TO authenticated
  USING (fn_user_owns_submission(intake_submission_id))
  WITH CHECK (fn_user_owns_submission(intake_submission_id));

CREATE POLICY "Users can delete own documents"
  ON uploaded_documents FOR DELETE
  TO authenticated
  USING (fn_user_owns_submission(intake_submission_id));
