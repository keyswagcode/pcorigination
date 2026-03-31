/*
  # Add PlacerBot Fields to Borrowers Table

  ## Summary
  Adds lender-eligibility fields needed by PlacerBot that do not already exist on the borrowers table.
  All fields are added conditionally (IF NOT EXISTS) to avoid conflicts.

  ## New Columns on `borrowers`
  - `dscr` (numeric) — Debt Service Coverage Ratio; calculated as monthly_rent / monthly_payment if not provided
  - `seasoning_months` (integer) — How long the borrower has owned the subject property (months)
  - `short_term_rental` (boolean) — Whether the property is used as a short-term rental (e.g., Airbnb)
  - `foreign_national` (boolean) — Whether the borrower is a foreign national (maps from existing domestic_or_international)
  - `first_time_investor` (boolean) — Whether this is the borrower's first investment property

  ## Notes
  - `foreign_national` defaults to false; can be auto-derived from `domestic_or_international = 'international'`
  - `first_time_investor` defaults to false; can be auto-derived from `real_estate_experience_years = 0`
  - No destructive changes; existing data is preserved
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'dscr'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN dscr numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'seasoning_months'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN seasoning_months integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'short_term_rental'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN short_term_rental boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'foreign_national'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN foreign_national boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'borrowers' AND column_name = 'first_time_investor'
  ) THEN
    ALTER TABLE borrowers ADD COLUMN first_time_investor boolean DEFAULT false;
  END IF;
END $$;
