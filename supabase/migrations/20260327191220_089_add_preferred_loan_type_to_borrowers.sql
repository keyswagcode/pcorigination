/*
  # Add Preferred Loan Type to Borrowers

  1. Changes
    - Add `preferred_loan_type` column to `borrowers` table
    - Allows borrowers to indicate their preferred loan product type
    - Options: bank_statement, dscr, fix_and_flip, not_sure

  2. Notes
    - Column is nullable to support existing records
    - Default is 'not_sure' for new borrowers who haven't selected
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'preferred_loan_type'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN preferred_loan_type text DEFAULT 'not_sure';
  END IF;
END $$;