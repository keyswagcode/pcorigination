/*
  # Ensure PlacerBot / eligibility columns exist on borrowers (prod repair)

  ## Why
  Migration 080 (20260318044310) was recorded in the migration history but its
  DDL never executed against the production database — all five columns it was
  supposed to add are missing. This breaks borrower profile creation now that
  the apply flow writes `foreign_national`, surfacing as a generic
  "An error occurred" (PostgREST PGRST204 / 42703 underneath).

  This migration re-adds the columns idempotently and reloads the PostgREST
  schema cache so the columns are immediately visible to the API.

  ## Columns (all IF NOT EXISTS, non-destructive)
  - dscr (numeric)
  - seasoning_months (integer)
  - short_term_rental (boolean default false)
  - foreign_national (boolean default false)
  - first_time_investor (boolean default false)
*/

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS dscr numeric;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS seasoning_months integer;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS short_term_rental boolean DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS foreign_national boolean DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS first_time_investor boolean DEFAULT false;

-- Make PostgREST pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';
