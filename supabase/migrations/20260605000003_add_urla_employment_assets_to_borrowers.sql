/*
  # Add remaining URLA 1003 sections to borrowers (all optional)

  Lets borrowers fill in as much of the 1003 as they want after pre-approval:

    - employment        (jsonb) - Section 1b/1c/1d employment list
    - other_income      (jsonb) - Section 1e other income sources
    - assets            (jsonb) - Section 2a/2b assets
    - liabilities       (jsonb) - Section 2c/2d liabilities
    - real_estate_owned (jsonb) - Section 3 properties owned

  All nullable JSONB arrays.
*/

ALTER TABLE borrowers
  ADD COLUMN IF NOT EXISTS employment jsonb,
  ADD COLUMN IF NOT EXISTS other_income jsonb,
  ADD COLUMN IF NOT EXISTS assets jsonb,
  ADD COLUMN IF NOT EXISTS liabilities jsonb,
  ADD COLUMN IF NOT EXISTS real_estate_owned jsonb;
