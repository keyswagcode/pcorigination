/*
  # Add income / debt / DTI fields to borrower_financial_profiles

  Supports calculating a borrower's income from however many months of bank
  statements we have (qualifying-income method) and their back-end
  debt-to-income ratio using monthly debt from the credit report.

  New columns (all nullable):
    - monthly_debt    (numeric) - total monthly debt payments from the credit report
    - dti             (numeric) - back-end DTI as a PERCENT (e.g. 42.5 = 42.5%)
                                  = monthly_debt / monthly_income * 100
    - income_method   (text)    - how monthly_income was derived
                                  (e.g. 'bank_statements_qualifying')
    - income_months   (integer) - number of statement months used for income
    - dti_computed_at (timestamptz) - when DTI was last recomputed

  monthly_income and income_estimate already exist on this table.
*/

ALTER TABLE borrower_financial_profiles
  ADD COLUMN IF NOT EXISTS monthly_debt numeric,
  ADD COLUMN IF NOT EXISTS dti numeric,
  ADD COLUMN IF NOT EXISTS income_method text,
  ADD COLUMN IF NOT EXISTS income_months integer,
  ADD COLUMN IF NOT EXISTS dti_computed_at timestamptz;
