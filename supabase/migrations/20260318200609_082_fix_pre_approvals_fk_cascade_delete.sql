/*
  # Fix pre_approvals foreign key to allow intake_submission deletion

  ## Problem
  The pre_approvals table has a NO ACTION foreign key on intake_submission_id,
  which prevents deleting an intake_submission if any pre_approval row references it.

  ## Fix
  - Drop the existing NO ACTION foreign key constraint on pre_approvals.intake_submission_id
  - Re-add it with ON DELETE CASCADE so deleting an intake_submission automatically
    removes associated pre_approval records

  ## Tables Modified
  - `pre_approvals`: foreign key on intake_submission_id changed from NO ACTION to CASCADE
*/

ALTER TABLE pre_approvals
  DROP CONSTRAINT IF EXISTS pre_approvals_intake_submission_id_fkey;

ALTER TABLE pre_approvals
  ADD CONSTRAINT pre_approvals_intake_submission_id_fkey
  FOREIGN KEY (intake_submission_id)
  REFERENCES intake_submissions(id)
  ON DELETE CASCADE;
