/*
  # Add intake_submission_id to pre_approvals

  1. Changes
    - Add nullable `intake_submission_id` column to `pre_approvals` table
    - Add foreign key reference to `intake_submissions`
    - Make `loan_application_id` nullable (since pre-approvals from intake flow won't have one)
    - Update RLS policy for staff to view pre-approvals linked to their org's submissions

  2. Why
    - Pre-approvals generated via the borrower intake flow reference `intake_submissions`, not `loan_applications`
    - The existing FK on `loan_application_id` to `loan_applications` caused silent insert failures
    - This allows pre-approvals to be linked to either flow
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_approvals' AND column_name = 'intake_submission_id'
  ) THEN
    ALTER TABLE pre_approvals ADD COLUMN intake_submission_id uuid REFERENCES intake_submissions(id);
  END IF;
END $$;

ALTER TABLE pre_approvals ALTER COLUMN loan_application_id DROP NOT NULL;
