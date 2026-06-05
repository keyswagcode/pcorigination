/*
  # Add URLA 1003 detail fields to borrowers

  Stores the post-pre-approval 1003 information we don't capture during the
  initial profile/pre-approval flow:

    - declarations        (jsonb) - Section 5a/5b Yes/No declarations (+ sub-answers)
    - demographic_info    (jsonb) - Section 8 HMDA demographic information
                                    (ethnicity, race, sex, "do not wish" flags)
    - military_service    (jsonb) - Section 7 military service
    - urla_details_completed_at (timestamptz) - when the borrower/broker finished

  All nullable JSONB so the shape can evolve without further migrations.
*/

ALTER TABLE borrowers
  ADD COLUMN IF NOT EXISTS declarations jsonb,
  ADD COLUMN IF NOT EXISTS demographic_info jsonb,
  ADD COLUMN IF NOT EXISTS military_service jsonb,
  ADD COLUMN IF NOT EXISTS urla_details_completed_at timestamptz;
