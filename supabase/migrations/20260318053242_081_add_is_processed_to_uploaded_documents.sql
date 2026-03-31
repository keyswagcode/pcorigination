/*
  # Add is_processed flag to uploaded_documents

  ## Summary
  Adds idempotency control to the document processing pipeline by tracking which
  documents have already been processed by the edge function.

  ## Changes

  ### Modified Tables
  - `uploaded_documents`
    - Added `is_processed` (boolean, default false) — tracks whether this document
      has been sent through the AI extraction pipeline

  ## Purpose
  Prevents reprocessing of already-handled documents, which was causing duplicate
  entries in downstream tables like `bank_statement_accounts`.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'uploaded_documents' AND column_name = 'is_processed'
  ) THEN
    ALTER TABLE uploaded_documents ADD COLUMN is_processed BOOLEAN DEFAULT false;
  END IF;
END $$;
