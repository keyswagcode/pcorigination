/*
  # Create the bank-statement processing tables (prod repair)

  ## Problem
  The process-documents edge function and several UI surfaces read/write
  `document_processing_jobs` and `bank_statement_accounts`, but NEITHER table
  was ever created in production (no CREATE TABLE exists in any migration —
  they predate the earliest migration in this repo and were never applied).
  Result: every borrower bank-statement upload fails — process-documents
  returns "Failed to create processing jobs" and the UI's results poll 404s,
  surfacing as "Could not extract data from your bank statements".

  Also adds the `error_message` column to uploaded_documents which
  process-documents writes on terminal failure and the UI reads for detail.

  ## Tables
  - document_processing_jobs: work queue rows, one per uploaded document.
  - bank_statement_accounts: one row per extracted statement/account.

  ## RLS
  Service role (the edge function) bypasses RLS. Authenticated access:
  - Borrowers can read rows tied to their own borrower record.
  - Staff/owners read via fn_caller_can_view_borrower(borrower_id).
*/

CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  intake_submission_id uuid REFERENCES intake_submissions(id) ON DELETE CASCADE,
  document_type text DEFAULT 'bank_statement',
  status text NOT NULL DEFAULT 'queued',
  priority integer DEFAULT 1,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  error_message text,
  error_details jsonb,
  last_retry_at timestamptz,
  started_at timestamptz,
  extraction_started_at timestamptz,
  extraction_completed_at timestamptz,
  extraction_confidence numeric,
  classified_type text,
  classification_confidence numeric,
  processing_duration_ms integer,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpj_submission ON document_processing_jobs(intake_submission_id);
CREATE INDEX IF NOT EXISTS idx_dpj_document ON document_processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_dpj_status ON document_processing_jobs(status);

CREATE TABLE IF NOT EXISTS bank_statement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid REFERENCES borrowers(id) ON DELETE CASCADE,
  document_id uuid REFERENCES uploaded_documents(id) ON DELETE SET NULL,
  intake_submission_id uuid REFERENCES intake_submissions(id) ON DELETE CASCADE,
  bank_name text,
  account_type text,
  account_holder_name text,
  statement_period_start date,
  statement_period_end date,
  opening_balance numeric,
  closing_balance numeric,
  available_cash numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  deposit_count integer,
  withdrawal_count integer,
  extraction_confidence numeric,
  extraction_version text,
  raw_extracted_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsa_submission ON bank_statement_accounts(intake_submission_id);
CREATE INDEX IF NOT EXISTS idx_bsa_borrower ON bank_statement_accounts(borrower_id);

ALTER TABLE uploaded_documents ADD COLUMN IF NOT EXISTS error_message text;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE document_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_accounts ENABLE ROW LEVEL SECURITY;

-- Borrowers poll job/results state for their own submissions; staff and the
-- owning broker get the same view via the shared helper.

DROP POLICY IF EXISTS "Borrowers can view own processing jobs" ON document_processing_jobs;
CREATE POLICY "Borrowers can view own processing jobs"
  ON document_processing_jobs FOR SELECT
  TO authenticated
  USING (
    intake_submission_id IN (
      SELECT id FROM intake_submissions WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff and owners can view processing jobs" ON document_processing_jobs;
CREATE POLICY "Staff and owners can view processing jobs"
  ON document_processing_jobs FOR SELECT
  TO authenticated
  USING (
    intake_submission_id IN (
      SELECT id FROM intake_submissions
      WHERE borrower_id IS NOT NULL AND fn_caller_can_view_borrower(borrower_id)
    )
  );

DROP POLICY IF EXISTS "Borrowers can view own bank statement accounts" ON bank_statement_accounts;
CREATE POLICY "Borrowers can view own bank statement accounts"
  ON bank_statement_accounts FOR SELECT
  TO authenticated
  USING (
    borrower_id IN (SELECT id FROM borrowers WHERE user_id = auth.uid())
    OR intake_submission_id IN (
      SELECT id FROM intake_submissions WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff and owners can view bank statement accounts" ON bank_statement_accounts;
CREATE POLICY "Staff and owners can view bank statement accounts"
  ON bank_statement_accounts FOR SELECT
  TO authenticated
  USING (borrower_id IS NOT NULL AND fn_caller_can_view_borrower(borrower_id));

NOTIFY pgrst, 'reload schema';
