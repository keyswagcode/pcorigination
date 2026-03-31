/*
  # Add Borrower Lifecycle Status

  This migration enhances the borrower workflow with a clear lifecycle progression
  that ties together profile completion, loan type selection, document upload,
  pre-approval, and application stages.

  ## 1. Changes to borrowers table
  
  - `lifecycle_stage` (text) - Tracks position in unified flow:
    - profile_created: Initial state, profile needs completion
    - loan_type_selected: Borrower has chosen their loan type
    - documents_uploaded: Financial documents have been uploaded
    - liquidity_verified: Documents processed and liquidity verified
    - pre_approved: Pre-approval complete, ready for loan application
    - application_started: Loan application in progress
    - application_submitted: Application submitted for review

  - `preferred_loan_type` already exists from previous migration

  ## 2. Important Notes
  
  - Lifecycle stage is separate from borrower_status (which tracks approval workflow)
  - This enables the unified flow: Loan Type -> Documents -> Pre-Approval -> Application
  - Each stage unlocks specific UI sections and capabilities
*/

-- Add lifecycle_stage column to borrowers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'lifecycle_stage'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN lifecycle_stage text DEFAULT 'profile_created';
  END IF;
END $$;

-- Add constraint for valid lifecycle stages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_lifecycle_stage'
  ) THEN
    ALTER TABLE borrowers ADD CONSTRAINT valid_lifecycle_stage 
      CHECK (lifecycle_stage IN (
        'profile_created',
        'loan_type_selected',
        'documents_uploaded',
        'liquidity_verified',
        'pre_approved',
        'application_started',
        'application_submitted'
      ));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create index for lifecycle stage queries
CREATE INDEX IF NOT EXISTS idx_borrowers_lifecycle_stage ON borrowers(lifecycle_stage);

-- Update existing borrowers based on their current state
UPDATE borrowers b
SET lifecycle_stage = CASE
  WHEN EXISTS (
    SELECT 1 FROM pre_approvals pa
    JOIN intake_submissions i ON pa.intake_submission_id = i.id
    WHERE i.borrower_id = b.id AND pa.status = 'completed'
  ) THEN 'pre_approved'
  WHEN EXISTS (
    SELECT 1 FROM uploaded_documents ud
    JOIN intake_submissions i ON ud.intake_submission_id = i.id
    WHERE i.borrower_id = b.id AND ud.processing_status = 'completed'
  ) THEN 'liquidity_verified'
  WHEN EXISTS (
    SELECT 1 FROM uploaded_documents ud
    JOIN intake_submissions i ON ud.intake_submission_id = i.id
    WHERE i.borrower_id = b.id
  ) THEN 'documents_uploaded'
  WHEN b.preferred_loan_type IS NOT NULL THEN 'loan_type_selected'
  ELSE 'profile_created'
END
WHERE b.lifecycle_stage IS NULL OR b.lifecycle_stage = 'profile_created';
